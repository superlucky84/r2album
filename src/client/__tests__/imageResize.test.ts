// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateTargetDimensions, resizeImageToWebpVariants } from '../lib/imageResize';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('imageResize', () => {
  it('preserves aspect ratio for landscape and portrait images', () => {
    expect(calculateTargetDimensions(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(calculateTargetDimensions(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(calculateTargetDimensions(4032, 3024, 480)).toEqual({ width: 480, height: 360 });
    expect(calculateTargetDimensions(3024, 4032, 480)).toEqual({ width: 360, height: 480 });
  });

  it('does not upscale images smaller than or equal to maxDimension', () => {
    expect(calculateTargetDimensions(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
    expect(calculateTargetDimensions(320, 240, 480)).toEqual({ width: 320, height: 240 });
    expect(calculateTargetDimensions(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it('resizes via Canvas into display and thumb WebP variants', async () => {
    const mockClose = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 4000,
        height: 3000,
        close: mockClose,
      })
    );

    const createdSizes: Array<{ width: number; height: number }> = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        const fakeCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            drawImage: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            transform: vi.fn(),
          }),
          toBlob: (cb: BlobCallback, type?: string) => {
            createdSizes.push({ width: fakeCanvas.width, height: fakeCanvas.height });
            const size = fakeCanvas.width > 500 ? 120_000 : 18_000;
            cb(new Blob([new Uint8Array(size)], { type: type ?? 'image/webp' }));
          },
        };
        return fakeCanvas as unknown as HTMLElement;
      }
      return origCreateElement(tagName);
    });

    const input = new Blob([new Uint8Array(3_000_000)], { type: 'image/jpeg' });
    const result = await resizeImageToWebpVariants(input, { orientation: 6 });

    expect(result.width).toBe(2048);
    expect(result.height).toBe(1536);
    expect(result.displayBytes).toBe(120_000);
    expect(result.thumbBytes).toBe(18_000);
    expect(result.originalBytes).toBe(3_000_000);
    expect(createdSizes).toContainEqual({ width: 2048, height: 1536 });
    expect(createdSizes).toContainEqual({ width: 480, height: 360 });
    expect(mockClose).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('rejects empty files and provides clear message for unsupported HEIC files', async () => {
    await expect(resizeImageToWebpVariants(new Blob([]))).rejects.toThrow('빈 이미지 파일');

    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
    );

    const heicFile = new File([new Uint8Array(100)], 'IMG_001.HEIC', { type: 'image/heic' });
    await expect(resizeImageToWebpVariants(heicFile)).rejects.toThrow('HEIC/HEIF');

    vi.unstubAllGlobals();
  });
});
