export interface ExifResult {
  takenAt: number | null;
  hasExifDate: boolean;
  orientation: number;
}

const DEFAULT_EXIF: ExifResult = {
  takenAt: null,
  hasExifDate: false,
  orientation: 1,
};

const EXIF_HEADER_READ_BYTES = 256 * 1024; // 256 KB covers APP1 EXIF in standard JPEGs

const TAG_ORIENTATION = 0x0112;
const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_CREATE_DATE = 0x9004;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;

const EXIF_DATE_REGEX = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/;
const EXIF_OFFSET_REGEX = /^([+-])(\d{2}):?(\d{2})$/;

function readAsciiString(
  view: DataView,
  offset: number,
  length: number,
  maxEnd: number
): string | null {
  if (offset < 0 || length <= 0 || offset + length > maxEnd) return null;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

export function parseExifDateString(raw: string, offsetStr?: string | null): number | null {
  const match = EXIF_DATE_REGEX.exec(raw.trim());
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);

  if (
    year < 1970 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  if (offsetStr) {
    const cleanedOffset = offsetStr.trim();
    if (cleanedOffset === 'Z' || cleanedOffset === 'z') {
      const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
      const check = new Date(utcMs);
      if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day
      ) {
        return null;
      }
      return utcMs;
    }

    const offsetMatch = EXIF_OFFSET_REGEX.exec(cleanedOffset);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '-' ? -1 : 1;
      const offHours = Number.parseInt(offsetMatch[2], 10);
      const offMins = Number.parseInt(offsetMatch[3], 10);
      if (offHours <= 14 && offMins <= 59) {
        const utcBase = Date.UTC(year, month - 1, day, hour, minute, second);
        const check = new Date(utcBase);
        if (
          check.getUTCFullYear() !== year ||
          check.getUTCMonth() !== month - 1 ||
          check.getUTCDate() !== day
        ) {
          return null;
        }
        const offsetMs = sign * (offHours * 60 + offMins) * 60 * 1000;
        return utcBase - offsetMs;
      }
    }
  }

  const localDate = new Date(year, month - 1, day, hour, minute, second);
  if (
    Number.isNaN(localDate.getTime()) ||
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day
  ) {
    return null;
  }
  return localDate.getTime();
}

function readTagStringValue(
  view: DataView,
  entryOffset: number,
  tiffStart: number,
  tiffEnd: number,
  littleEndian: boolean
): string | null {
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  // ASCII = 2
  if (type !== 2 || count === 0 || count > 256) return null;

  if (count <= 4) {
    return readAsciiString(view, entryOffset + 8, count, tiffEnd);
  }
  const valueOffset = tiffStart + view.getUint32(entryOffset + 8, littleEndian);
  return readAsciiString(view, valueOffset, count, tiffEnd);
}

function parseTiffExif(view: DataView, tiffStart: number, tiffEnd: number): ExifResult {
  if (tiffStart + 8 > tiffEnd) return { ...DEFAULT_EXIF };

  const byteOrder = view.getUint16(tiffStart, false);
  let littleEndian: boolean;
  if (byteOrder === 0x4949) {
    littleEndian = true; // II (Intel)
  } else if (byteOrder === 0x4d4d) {
    littleEndian = false; // MM (Motorola)
  } else {
    return { ...DEFAULT_EXIF };
  }

  // TIFF magic number must be 42 (0x002A)
  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002a) {
    return { ...DEFAULT_EXIF };
  }

  const firstIfdRelative = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0Offset = tiffStart + firstIfdRelative;
  if (ifd0Offset < tiffStart || ifd0Offset + 2 > tiffEnd) {
    return { ...DEFAULT_EXIF };
  }

  let orientation = 1;
  let exifIfdOffset: number | null = null;
  let dateTimeFallback: string | null = null;

  const ifd0Count = view.getUint16(ifd0Offset, littleEndian);
  for (let i = 0; i < ifd0Count; i += 1) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > tiffEnd) break;

    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === TAG_ORIENTATION) {
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      if (type === 3 && count >= 1) {
        const val = view.getUint16(entryOffset + 8, littleEndian);
        if (val >= 1 && val <= 8) {
          orientation = val;
        }
      }
    } else if (tag === TAG_DATE_TIME) {
      dateTimeFallback = readTagStringValue(view, entryOffset, tiffStart, tiffEnd, littleEndian);
    } else if (tag === TAG_EXIF_IFD_POINTER) {
      const type = view.getUint16(entryOffset + 2, littleEndian);
      if (type === 4) {
        const rel = view.getUint32(entryOffset + 8, littleEndian);
        if (rel > 0) {
          exifIfdOffset = tiffStart + rel;
        }
      }
    }
  }

  let dateTimeOriginal: string | null = null;
  let createDate: string | null = null;
  let offsetOriginal: string | null = null;
  let offsetDigitized: string | null = null;

  if (exifIfdOffset !== null && exifIfdOffset >= tiffStart && exifIfdOffset + 2 <= tiffEnd) {
    const exifCount = view.getUint16(exifIfdOffset, littleEndian);
    for (let i = 0; i < exifCount; i += 1) {
      const entryOffset = exifIfdOffset + 2 + i * 12;
      if (entryOffset + 12 > tiffEnd) break;

      const tag = view.getUint16(entryOffset, littleEndian);
      if (tag === TAG_DATE_TIME_ORIGINAL) {
        dateTimeOriginal = readTagStringValue(view, entryOffset, tiffStart, tiffEnd, littleEndian);
      } else if (tag === TAG_CREATE_DATE) {
        createDate = readTagStringValue(view, entryOffset, tiffStart, tiffEnd, littleEndian);
      } else if (tag === TAG_OFFSET_TIME_ORIGINAL) {
        offsetOriginal = readTagStringValue(view, entryOffset, tiffStart, tiffEnd, littleEndian);
      } else if (tag === TAG_OFFSET_TIME_DIGITIZED) {
        offsetDigitized = readTagStringValue(view, entryOffset, tiffStart, tiffEnd, littleEndian);
      }
    }
  }

  let takenAt: number | null = null;
  if (dateTimeOriginal) {
    takenAt = parseExifDateString(dateTimeOriginal, offsetOriginal);
  }
  if (takenAt === null && createDate) {
    takenAt = parseExifDateString(createDate, offsetDigitized ?? offsetOriginal);
  }
  if (takenAt === null && dateTimeFallback) {
    takenAt = parseExifDateString(dateTimeFallback, null);
  }

  return {
    takenAt,
    hasExifDate: takenAt !== null,
    orientation,
  };
}

/**
 * Extracts EXIF DateTimeOriginal / CreateDate and Orientation from a JPEG ArrayBuffer.
 * Returns safe defaults for non-JPEG formats (PNG, WebP, GIF) or corrupted headers.
 */
export function extractExifFromBuffer(buffer: ArrayBuffer): ExifResult {
  if (buffer.byteLength < 12) return { ...DEFAULT_EXIF };

  try {
    const view = new DataView(buffer);
    // Check JPEG SOI marker (0xFFD8)
    if (view.getUint16(0, false) !== 0xffd8) {
      return { ...DEFAULT_EXIF };
    }

    let offset = 2;
    const totalLength = view.byteLength;

    while (offset + 4 <= totalLength) {
      // Skip padding 0xFF bytes
      if (view.getUint8(offset) !== 0xff) {
        return { ...DEFAULT_EXIF };
      }
      while (offset < totalLength && view.getUint8(offset) === 0xff) {
        offset += 1;
      }
      if (offset >= totalLength) break;

      const marker = view.getUint8(offset);
      offset += 1;

      // SOS (0xDA) or EOI (0xD9) -> end of metadata headers
      if (marker === 0xda || marker === 0xd9) {
        break;
      }

      // Standalone markers without length (RST0..RST7, TEM)
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        continue;
      }

      if (offset + 2 > totalLength) break;
      const segmentLength = view.getUint16(offset, false);
      if (segmentLength < 2) break;

      const segmentDataStart = offset + 2;
      const segmentEnd = Math.min(offset + segmentLength, totalLength);

      // APP1 marker (0xE1) with "Exif\0\0" header
      if (marker === 0xe1 && segmentDataStart + 6 <= segmentEnd) {
        const isExif =
          view.getUint8(segmentDataStart) === 0x45 && // E
          view.getUint8(segmentDataStart + 1) === 0x78 && // x
          view.getUint8(segmentDataStart + 2) === 0x69 && // i
          view.getUint8(segmentDataStart + 3) === 0x66 && // f
          view.getUint8(segmentDataStart + 4) === 0x00 &&
          view.getUint8(segmentDataStart + 5) === 0x00;

        if (isExif) {
          return parseTiffExif(view, segmentDataStart + 6, segmentEnd);
        }
      }

      offset += segmentLength;
    }

    return { ...DEFAULT_EXIF };
  } catch {
    return { ...DEFAULT_EXIF };
  }
}

export async function extractExifFromFile(file: Blob): Promise<ExifResult> {
  try {
    const slice = file.size > EXIF_HEADER_READ_BYTES ? file.slice(0, EXIF_HEADER_READ_BYTES) : file;
    const buffer = await slice.arrayBuffer();
    return extractExifFromBuffer(buffer);
  } catch {
    return { ...DEFAULT_EXIF };
  }
}
