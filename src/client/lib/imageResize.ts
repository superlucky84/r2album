import {
  DISPLAY_MAX_BYTES,
  DISPLAY_MAX_DIMENSION,
  DISPLAY_WEBP_QUALITY,
  THUMB_MAX_BYTES,
  THUMB_MAX_DIMENSION,
  THUMB_WEBP_QUALITY,
} from '@/shared/constants';

export interface Dimensions {
  width: number;
  height: number;
}

export interface ResizedImageVariants {
  displayBlob: Blob;
  thumbBlob: Blob;
  width: number;
  height: number;
  displayBytes: number;
  thumbBytes: number;
  originalBytes: number;
}

export interface ResizeOptions {
  orientation?: number;
}

const HEIC_EXT_REGEX = /\.(heic|heif)$/i;
const QUALITY_STEP = 0.08;
const MIN_WEBP_QUALITY = 0.4;

/**
 * Calculates target width/height constrained by maxDimension while preserving aspect ratio.
 * Never upscales images that are already smaller than or equal to maxDimension.
 */
export function calculateTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number
): Dimensions {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('유효하지 않은 이미지 해상도입니다.');
  }

  const longestSide = Math.max(sourceWidth, sourceHeight);
  if (longestSide <= maxDimension) {
    return {
      width: Math.round(sourceWidth),
      height: Math.round(sourceHeight),
    };
  }

  const scale = maxDimension / longestSide;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

interface DecodedSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  alreadyOriented: boolean;
  cleanup: () => void;
}

function isHeicLikeFile(file: Blob): boolean {
  const type = file.type.toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  if ('name' in file && typeof (file as File).name === 'string') {
    return HEIC_EXT_REGEX.test((file as File).name);
  }
  return false;
}

function buildUnsupportedFormatError(file: Blob): Error {
  if (isHeicLikeFile(file)) {
    return new Error(
      '현재 브라우저에서 HEIC/HEIF 이미지를 디코딩할 수 없습니다. Safari에서 업로드하거나 JPEG/PNG/WebP로 변환해 주세요.'
    );
  }
  return new Error(
    '지원하지 않거나 손상된 이미지 형식입니다. JPEG, PNG, WebP 또는 GIF 이미지를 선택해 주세요.'
  );
}

async function decodeWithImageElement(file: Blob): Promise<DecodedSource> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw buildUnsupportedFormatError(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(buildUnsupportedFormatError(file));
      el.src = objectUrl;
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      URL.revokeObjectURL(objectUrl);
      throw buildUnsupportedFormatError(file);
    }

    return {
      source: img,
      width,
      height,
      // Modern browsers auto-orient <img> via CSS/decode, but older ones may not;
      // we only apply manual EXIF transform when explicitly requested in fallback tests/older runtimes.
      alreadyOriented: true,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

async function decodeImageFile(file: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          alreadyOriented: true,
          cleanup: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Fall back to HTMLImageElement decoding
    }
  }

  return decodeWithImageElement(file);
}

export function applyExifOrientationTransform(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  drawWidth: number,
  drawHeight: number
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, drawWidth, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, drawWidth, drawHeight);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, drawHeight);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, drawHeight, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, drawHeight, drawWidth);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, drawWidth);
      break;
    default:
      break;
  }
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('WebP 이미지 인코딩에 실패했습니다.'));
          return;
        }
        if (blob.type && blob.type !== 'image/webp') {
          reject(new Error('이 브라우저는 Canvas WebP 인코딩을 지원하지 않습니다.'));
          return;
        }
        resolve(blob);
      },
      'image/webp',
      quality
    );
  });
}

async function renderWebpVariant(
  decoded: DecodedSource,
  maxDimension: number,
  initialQuality: number,
  maxBytes: number,
  orientation: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const needsManualOrientation = !decoded.alreadyOriented && orientation >= 2 && orientation <= 8;
  const swapsAxes = needsManualOrientation && orientation >= 5 && orientation <= 8;

  const orientedWidth = swapsAxes ? decoded.height : decoded.width;
  const orientedHeight = swapsAxes ? decoded.width : decoded.height;
  const target = calculateTargetDimensions(orientedWidth, orientedHeight, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('브라우저 Canvas 2D 컨텍스트를 생성할 수 없습니다.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (needsManualOrientation) {
    const drawW = swapsAxes ? target.height : target.width;
    const drawH = swapsAxes ? target.width : target.height;
    ctx.save();
    applyExifOrientationTransform(ctx, orientation, drawW, drawH);
    ctx.drawImage(decoded.source, 0, 0, drawW, drawH);
    ctx.restore();
  } else {
    ctx.drawImage(decoded.source, 0, 0, target.width, target.height);
  }

  let quality = initialQuality;
  let blob = await canvasToWebpBlob(canvas, quality);

  while (blob.size > maxBytes && quality - QUALITY_STEP >= MIN_WEBP_QUALITY) {
    quality = Math.max(MIN_WEBP_QUALITY, Number((quality - QUALITY_STEP).toFixed(2)));
    blob = await canvasToWebpBlob(canvas, quality);
  }

  if (blob.size > maxBytes) {
    throw new Error(
      `변환된 WebP 용량(${Math.round(blob.size / 1024)}KB)이 허용 한도(${Math.round(maxBytes / 1024)}KB)를 초과했습니다.`
    );
  }

  return { blob, width: target.width, height: target.height };
}

/**
 * Converts an image File/Blob into two WebP variants in the browser:
 * - display: max 2048px, quality 0.82, <= 5 MB
 * - thumb:   max 480px,  quality 0.75, <= 512 KB
 */
export async function resizeImageToWebpVariants(
  file: Blob,
  options: ResizeOptions = {}
): Promise<ResizedImageVariants> {
  if (file.size === 0) {
    throw new Error('빈 이미지 파일은 업로드할 수 없습니다.');
  }

  const orientation = options.orientation ?? 1;
  const decoded = await decodeImageFile(file);

  try {
    const [display, thumb] = await Promise.all([
      renderWebpVariant(
        decoded,
        DISPLAY_MAX_DIMENSION,
        DISPLAY_WEBP_QUALITY,
        DISPLAY_MAX_BYTES,
        orientation
      ),
      renderWebpVariant(
        decoded,
        THUMB_MAX_DIMENSION,
        THUMB_WEBP_QUALITY,
        THUMB_MAX_BYTES,
        orientation
      ),
    ]);

    return {
      displayBlob: display.blob,
      thumbBlob: thumb.blob,
      width: display.width,
      height: display.height,
      displayBytes: display.blob.size,
      thumbBytes: thumb.blob.size,
      originalBytes: file.size,
    };
  } finally {
    decoded.cleanup();
  }
}
