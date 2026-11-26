import { describe, expect, it } from 'vitest';
import { extractExifFromBuffer, extractExifFromFile, parseExifDateString } from '../lib/exif';

/**
 * Helper to construct a valid minimal JPEG with an APP1 EXIF segment
 * containing configurable endianness, orientation, and date tags.
 */
function buildJpegWithExif(options: {
  littleEndian: boolean;
  orientation?: number;
  dateTimeOriginal?: string;
  createDate?: string;
  offsetTimeOriginal?: string;
}): ArrayBuffer {
  const le = options.littleEndian;
  const tiff = new Uint8Array(512);
  const view = new DataView(tiff.buffer);

  // TIFF header
  view.setUint16(0, le ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 0x002a, le);
  view.setUint32(4, 8, le); // IFD0 starts at offset 8

  const ifd0Entries: Array<() => void> = [];
  let cursor = 8;
  let dataCursor = 240;

  const writeAscii = (text: string): { offset: number; length: number } => {
    const start = dataCursor;
    for (let i = 0; i < text.length; i += 1) {
      tiff[dataCursor++] = text.charCodeAt(i);
    }
    tiff[dataCursor++] = 0; // null terminator
    return { offset: start, length: text.length + 1 };
  };

  const hasExifIfd = Boolean(
    options.dateTimeOriginal || options.createDate || options.offsetTimeOriginal
  );
  const ifd0Count = (options.orientation !== undefined ? 1 : 0) + (hasExifIfd ? 1 : 0);
  view.setUint16(cursor, ifd0Count, le);
  cursor += 2;

  const exifIfdOffset = 100;

  if (options.orientation !== undefined) {
    ifd0Entries.push(() => {
      view.setUint16(cursor, 0x0112, le); // Orientation
      view.setUint16(cursor + 2, 3, le); // SHORT
      view.setUint32(cursor + 4, 1, le);
      view.setUint16(cursor + 8, options.orientation!, le);
      cursor += 12;
    });
  }

  if (hasExifIfd) {
    ifd0Entries.push(() => {
      view.setUint16(cursor, 0x8769, le); // ExifIFDPointer
      view.setUint16(cursor + 2, 4, le); // LONG
      view.setUint32(cursor + 4, 1, le);
      view.setUint32(cursor + 8, exifIfdOffset, le);
      cursor += 12;
    });
  }

  for (const fn of ifd0Entries) fn();
  view.setUint32(cursor, 0, le); // next IFD = 0

  if (hasExifIfd) {
    let eCursor = exifIfdOffset;
    const exifEntries: Array<{ tag: number; str: string }> = [];
    if (options.dateTimeOriginal) {
      exifEntries.push({ tag: 0x9003, str: options.dateTimeOriginal });
    }
    if (options.createDate) {
      exifEntries.push({ tag: 0x9004, str: options.createDate });
    }
    if (options.offsetTimeOriginal) {
      exifEntries.push({ tag: 0x9011, str: options.offsetTimeOriginal });
    }

    view.setUint16(eCursor, exifEntries.length, le);
    eCursor += 2;
    for (const entry of exifEntries) {
      const { offset, length } = writeAscii(entry.str);
      view.setUint16(eCursor, entry.tag, le);
      view.setUint16(eCursor + 2, 2, le); // ASCII
      view.setUint32(eCursor + 4, length, le);
      view.setUint32(eCursor + 8, offset, le);
      eCursor += 12;
    }
    view.setUint32(eCursor, 0, le);
  }

  const tiffUsed = tiff.slice(0, dataCursor);
  // JPEG: SOI (2) + APP1 marker (2) + length (2) + "Exif\0\0" (6) + TIFF + EOI (2)
  const app1Length = 2 + 6 + tiffUsed.byteLength;
  const jpeg = new Uint8Array(2 + 2 + app1Length + 2);
  const jpegView = new DataView(jpeg.buffer);

  jpegView.setUint16(0, 0xffd8, false); // SOI
  jpegView.setUint16(2, 0xffe1, false); // APP1
  jpegView.setUint16(4, app1Length, false);
  jpeg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"
  jpeg.set(tiffUsed, 12);
  jpegView.setUint16(12 + tiffUsed.byteLength, 0xffd9, false); // EOI

  return jpeg.buffer;
}

describe('exif parser', () => {
  it('extracts DateTimeOriginal, OffsetTimeOriginal, and Orientation from little-endian JPEG', async () => {
    const buffer = buildJpegWithExif({
      littleEndian: true,
      orientation: 6,
      dateTimeOriginal: '2026:05:10 14:30:00',
      offsetTimeOriginal: '+09:00',
    });

    const result = extractExifFromBuffer(buffer);
    expect(result.hasExifDate).toBe(true);
    expect(result.orientation).toBe(6);
    expect(result.takenAt).toBe(Date.UTC(2026, 4, 10, 5, 30, 0));

    const fileResult = await extractExifFromFile(new Blob([buffer], { type: 'image/jpeg' }));
    expect(fileResult).toEqual(result);
  });

  it('extracts CreateDate fallback and Orientation from big-endian JPEG', () => {
    const buffer = buildJpegWithExif({
      littleEndian: false,
      orientation: 8,
      createDate: '2025:12:25 09:15:30',
    });

    const result = extractExifFromBuffer(buffer);
    expect(result.hasExifDate).toBe(true);
    expect(result.orientation).toBe(8);
    expect(result.takenAt).toBe(new Date(2025, 11, 25, 9, 15, 30).getTime());
  });

  it('returns safe fallback for PNG and WebP files without EXIF', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);

    expect(extractExifFromBuffer(pngHeader.buffer)).toEqual({
      takenAt: null,
      hasExifDate: false,
      orientation: 1,
    });
    expect(extractExifFromBuffer(webpHeader.buffer)).toEqual({
      takenAt: null,
      hasExifDate: false,
      orientation: 1,
    });
  });

  it('handles corrupted/truncated JPEG APP1 headers without throwing', () => {
    const truncated = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0xff, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a,
    ]);
    expect(extractExifFromBuffer(truncated.buffer)).toEqual({
      takenAt: null,
      hasExifDate: false,
      orientation: 1,
    });
  });

  it('rejects invalid EXIF dates such as 0000:00:00 00:00:00', () => {
    expect(parseExifDateString('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDateString('2026:02:31 12:00:00')).toBeNull();
    expect(parseExifDateString('not-a-date')).toBeNull();
  });
});
