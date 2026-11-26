import { describe, expect, it, vi } from 'vitest';
import type { ImageItem, ImagesRangeResponse } from '@/shared/types';
import { createGalleryStore } from '../stores/galleryStore';

function makeItems(prefix: string, offset: number, count: number): ImageItem[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `${prefix}-${offset + i}`;
    return {
      id,
      albumId: null,
      albumName: null,
      caption: `Photo ${id}`,
      tags: [],
      takenAt: 1_700_000_000_000 - (offset + i) * 1000,
      hasExifDate: true,
      uploadedAt: 1_700_000_000_000,
      width: 1600,
      height: 1200,
      thumbUrl: `/api/media/thumb/${id}`,
      displayUrl: `/api/media/display/${id}`,
    };
  });
}

describe('galleryStore', () => {
  it('deduplicates concurrent and already-cached chunk fetches', async () => {
    const resolvers: Array<() => void> = [];
    const fetchImages = vi.fn(async ({ offset = 0, limit = 40 }) => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      return {
        total: 120,
        offset,
        limit,
        items: makeItems('all', offset, limit),
      } satisfies ImagesRangeResponse;
    });

    const store = createGalleryStore({ fetchImages });

    const p1 = store.ensureChunks([0, 1]);
    const p2 = store.ensureChunks([0, 1]); // duplicate in-flight request

    expect(fetchImages).toHaveBeenCalledTimes(2);
    expect(store.isChunkInFlight(0)).toBe(true);
    expect(store.isChunkInFlight(1)).toBe(true);

    while (resolvers.length > 0) resolvers.shift()?.();
    await Promise.all([p1, p2]);

    expect(store.isChunkLoaded(0)).toBe(true);
    expect(store.isChunkLoaded(1)).toBe(true);
    expect(store.getItem(0)?.id).toBe('all-0');
    expect(store.getItem(40)?.id).toBe('all-40');

    // Subsequent call for cached chunks triggers zero additional fetches
    await store.ensureChunks([0, 1]);
    expect(fetchImages).toHaveBeenCalledTimes(2);
  });

  it('ignores stale responses when filter changes rapidly', async () => {
    let resolveSlowAlbumA!: (res: ImagesRangeResponse) => void;
    let resolveFastAlbumB!: (res: ImagesRangeResponse) => void;

    const fetchImages = vi.fn(({ albumId }) => {
      if (albumId === 'album-a') {
        return new Promise<ImagesRangeResponse>((resolve) => {
          resolveSlowAlbumA = resolve;
        });
      }
      if (albumId === 'album-b') {
        return new Promise<ImagesRangeResponse>((resolve) => {
          resolveFastAlbumB = resolve;
        });
      }
      return Promise.resolve({
        total: 10,
        offset: 0,
        limit: 40,
        items: makeItems('init', 0, 10),
      });
    });

    const store = createGalleryStore({ fetchImages });

    const pA = store.setFilter({ albumId: 'album-a' });
    const pB = store.setFilter({ albumId: 'album-b' });

    // Resolve newer filter (album-b) first
    resolveFastAlbumB({
      total: 3,
      offset: 0,
      limit: 40,
      items: makeItems('b', 0, 3),
    });
    await pB;

    expect(store.getSnapshot().total).toBe(3);
    expect(store.getItem(0)?.id).toBe('b-0');

    // Now stale album-a response arrives late -> must be ignored!
    resolveSlowAlbumA({
      total: 99,
      offset: 0,
      limit: 40,
      items: makeItems('a', 0, 40),
    });
    await pA;

    expect(store.getSnapshot().filter.albumId).toBe('album-b');
    expect(store.getSnapshot().total).toBe(3);
    expect(store.getItem(0)?.id).toBe('b-0');
  });
});
