// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { AlbumSummary, ImageItem } from '@/shared/types';
import { UploadDropzone } from '../components/admin/UploadDropzone';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MOCK_ALBUMS: AlbumSummary[] = [
  {
    id: 'album-jeju',
    name: '제주 여행',
    description: '',
    imageCount: 3,
    createdAt: 1000,
    updatedAt: 1000,
  },
];

function makeImageItem(id: string, takenAt: number): ImageItem {
  return {
    id,
    albumId: 'album-jeju',
    albumName: '제주 여행',
    caption: '',
    tags: ['바다', '가족'],
    takenAt,
    hasExifDate: true,
    uploadedAt: takenAt,
    width: 2048,
    height: 1536,
    thumbUrl: `/api/media/thumb/${id}`,
    displayUrl: `/api/media/display/${id}`,
  };
}

describe('UploadDropzone component', () => {
  it('extracts EXIF before resizing, enforces concurrency 3, and displays size savings', async () => {
    const callOrder: string[] = [];
    let currentInFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];

    const extractExif = vi.fn(async (file: Blob) => {
      callOrder.push(`exif:${(file as File).name}`);
      return { takenAt: 1_700_000_000_000, hasExifDate: true, orientation: 6 };
    });

    const resizeImage = vi.fn(async (file: Blob) => {
      callOrder.push(`resize:${(file as File).name}`);
      return {
        displayBlob: new Blob([new Uint8Array(200_000)], { type: 'image/webp' }),
        thumbBlob: new Blob([new Uint8Array(20_000)], { type: 'image/webp' }),
        width: 2048,
        height: 1536,
        displayBytes: 200_000,
        thumbBytes: 20_000,
        originalBytes: file.size,
      };
    });

    const uploadImage = vi.fn(async (payload) => {
      currentInFlight += 1;
      maxInFlight = Math.max(maxInFlight, currentInFlight);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      currentInFlight -= 1;
      return makeImageItem(`img-${payload.metadata.originalFilename}`, 1_700_000_000_000);
    });

    const onBatchFinished = vi.fn();

    render(
      <UploadDropzone
        albums={MOCK_ALBUMS}
        extractExif={extractExif}
        resizeImage={resizeImage}
        uploadImage={uploadImage}
        onBatchFinished={onBatchFinished}
      />
    );

    // Choose default album & tags
    await act(() => {
      fireEvent.change(screen.getByTestId('upload-album-select'), {
        target: { value: 'album-jeju' },
      });
      fireEvent.input(screen.getByTestId('upload-tags-input'), {
        target: { value: '바다, 가족' },
      });
    });

    const files = Array.from({ length: 5 }, (_, i) => {
      const f = new File([new Uint8Array(2_200_000)], `photo-${i + 1}.jpg`, {
        type: 'image/jpeg',
      });
      return f;
    });

    await act(async () => {
      const dropzone = screen.getByTestId('upload-dropzone');
      fireEvent.drop(dropzone, { dataTransfer: { files } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Concurrency strictly capped at 3
    expect(maxInFlight).toBe(3);
    expect(resolvers.length).toBe(3);

    // Finish first wave (3 files) -> triggers remaining 2
    await act(async () => {
      while (resolvers.length > 0) {
        resolvers.shift()?.();
      }
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(resolvers.length).toBe(2);

    // Finish second wave
    await act(async () => {
      while (resolvers.length > 0) {
        resolvers.shift()?.();
      }
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(uploadImage).toHaveBeenCalledTimes(5);
    expect(onBatchFinished).toHaveBeenCalledTimes(1);
    expect(callOrder.indexOf('exif:photo-1.jpg')).toBeLessThan(
      callOrder.indexOf('resize:photo-1.jpg')
    );

    // Verify metadata sent to upload API
    expect(uploadImage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          albumId: 'album-jeju',
          tags: ['바다', '가족'],
          hasExifDate: true,
          takenAt: 1_700_000_000_000,
        }),
      })
    );

    // Savings percentage displayed (2.2MB -> 220KB = 90% savings)
    const savingsBadges = screen.getAllByTestId('upload-savings');
    expect(savingsBadges[0].textContent).toContain('90% 절감');
  });

  it('shows error message on failure and retries successfully', async () => {
    let attempt = 0;
    const extractExif = vi.fn(async () => ({
      takenAt: null,
      hasExifDate: false,
      orientation: 1,
    }));
    const resizeImage = vi.fn(async (file: Blob) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('네트워크 오류');
      }
      return {
        displayBlob: new Blob([new Uint8Array(100)], { type: 'image/webp' }),
        thumbBlob: new Blob([new Uint8Array(50)], { type: 'image/webp' }),
        width: 800,
        height: 600,
        displayBytes: 100,
        thumbBytes: 50,
        originalBytes: file.size,
      };
    });
    const uploadImage = vi.fn(async () => makeImageItem('img-ok', Date.now()));

    render(
      <UploadDropzone
        albums={MOCK_ALBUMS}
        extractExif={extractExif}
        resizeImage={resizeImage}
        uploadImage={uploadImage}
      />
    );

    const file = new File([new Uint8Array(1000)], 'retry-me.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.drop(screen.getByTestId('upload-dropzone'), { dataTransfer: { files: [file] } });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('upload-item-error').textContent).toContain('네트워크 오류');
    expect(uploadImage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('upload-retry-all'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('upload-item-error')).toBeNull();
  });
});
