// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { screen } from '@testing-library/dom';
import type { ImageItem } from '@/shared/types';
import { UploadDropzone } from '../components/admin/UploadDropzone';
import { createUploadStore } from '../stores/uploadStore';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeUploadedItem(name: string): ImageItem {
  return {
    id: `img-${name}`,
    albumId: null,
    albumName: null,
    caption: '',
    tags: [],
    takenAt: Date.now(),
    hasExifDate: false,
    uploadedAt: Date.now(),
    width: 1000,
    height: 800,
    thumbUrl: `/api/media/thumb/img-${name}`,
    displayUrl: `/api/media/display/img-${name}`,
  };
}

describe('uploadStore background persistence, Wake Lock & beforeunload', () => {
  it('continues uploading after UploadDropzone unmounts, requests/releases Wake Lock, and guards beforeunload', async () => {
    const releaseWakeLock = vi.fn().mockResolvedValue(undefined);
    const requestWakeLock = vi.fn().mockResolvedValue({ release: releaseWakeLock });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: requestWakeLock },
    });

    const uploadResolvers: Array<() => void> = [];
    const store = createUploadStore({
      extractExif: vi.fn(async () => ({ takenAt: null, hasExifDate: false, orientation: 1 })),
      resizeImage: vi.fn(async (file) => ({
        displayBlob: new Blob([new Uint8Array(100)], { type: 'image/webp' }),
        thumbBlob: new Blob([new Uint8Array(20)], { type: 'image/webp' }),
        width: 1000,
        height: 800,
        displayBytes: 100,
        thumbBytes: 20,
        originalBytes: file.size,
      })),
      uploadImage: vi.fn(async (payload) => {
        await new Promise<void>((resolve) => {
          uploadResolvers.push(resolve);
        });
        return makeUploadedItem(payload.metadata.originalFilename);
      }),
    });

    const onBatchFinished = vi.fn();
    store.onBatchFinished(onBatchFinished);

    // Mount UploadDropzone and enqueue 2 files
    render(<UploadDropzone albums={[]} store={store} />);
    const files = [
      new File([new Uint8Array(1000)], 'a.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(1000)], 'b.jpg', { type: 'image/jpeg' }),
    ];

    await act(async () => {
      store.enqueueFiles(files);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.getSnapshot().inProgressCount).toBe(2);
    expect(requestWakeLock).toHaveBeenCalledWith('screen');
    expect(screen.getByTestId('upload-background-notice')).toBeTruthy();

    // beforeunload is guarded while uploading
    const unloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    // Simulate switching away to Gallery or another admin tab (unmount UploadDropzone!)
    cleanup();

    // Complete uploads while unmounted
    while (uploadResolvers.length > 0) {
      uploadResolvers.shift()?.();
    }
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(store.getSnapshot().doneCount).toBe(2);
    expect(store.getSnapshot().inProgressCount).toBe(0);
    expect(onBatchFinished).toHaveBeenCalledTimes(1);
    expect(releaseWakeLock).toHaveBeenCalledTimes(1);

    // beforeunload is no longer blocked once uploads finish
    const unloadAfter = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unloadAfter);
    expect(unloadAfter.defaultPrevented).toBe(false);

    // Remounting UploadDropzone restores the completed upload queue UI
    render(<UploadDropzone albums={[]} store={store} />);
    expect(screen.getAllByTestId('upload-queue-item')).toHaveLength(2);
  });
});
