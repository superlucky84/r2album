// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { FrameIdsResponse, ImageItem, ImagesRangeResponse } from '@/shared/types';
import { GalleryView } from '../components/GalleryView';
import { PhotoFrameMode } from '../components/PhotoFrameMode';
import { createGalleryStore } from '../stores/galleryStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

function makeBatch(prefix: string, offset: number, limit: number, total: number): ImageItem[] {
  const count = Math.max(0, Math.min(limit, total - offset));
  return Array.from({ length: count }, (_, i) => {
    const idx = offset + i;
    return {
      id: `${prefix}-${idx}`,
      albumId: null,
      albumName: null,
      caption: `${prefix} photo ${idx}`,
      tags: [],
      takenAt: 1_700_000_000_000 - idx * 1000,
      hasExifDate: true,
      uploadedAt: 1_700_000_000_000,
      width: 2048,
      height: 1536,
      thumbUrl: `/api/media/thumb/${prefix}-${idx}`,
      displayUrl: `/api/media/display/${prefix}-${idx}`,
    };
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Phase 7 Stress & Error Recovery Hardening', () => {
  it('maintains bounded DOM count under 30,000-item rapid scrolling and ignores stale filter responses', async () => {
    const TOTAL = 30_000;
    const pendingResolvers: Array<{ tag: string; resolve: (r: ImagesRangeResponse) => void }> = [];

    const fetchFilters = vi.fn(async () => ({
      albums: [
        {
          id: 'alb-a',
          name: 'Album A',
          description: '',
          imageCount: 500,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'alb-b',
          name: 'Album B',
          description: '',
          imageCount: 3,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      tags: [],
      totalImages: TOTAL,
    }));

    const fetchImages = vi.fn(({ offset = 0, limit = 40, albumId }) => {
      if (albumId === 'alb-a') {
        return new Promise<ImagesRangeResponse>((resolve) => {
          pendingResolvers.push({ tag: 'alb-a', resolve });
        });
      }
      if (albumId === 'alb-b') {
        return Promise.resolve({
          total: 3,
          offset: 0,
          limit,
          items: makeBatch('albb', 0, 3, 3),
        });
      }
      return Promise.resolve({
        total: TOTAL,
        offset,
        limit,
        items: makeBatch('all', offset, limit, TOTAL),
      });
    });

    const store = createGalleryStore({ fetchFilters, fetchImages });
    render(<GalleryView isAdmin={false} store={store} />);
    await flushMicrotasks();

    const grid = screen.getByTestId('virtual-grid');
    expect(grid.children.length).toBeGreaterThan(0);
    expect(grid.children.length).toBeLessThan(80);

    // Simulate rapid scroll jumps to 50%, 90%, 25%, bottom, and back to top
    const scrollPositions = [250_000, 450_000, 125_000, 900_000, 0];
    for (const y of scrollPositions) {
      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
        top: -y,
        left: 0,
        bottom: 800,
        right: 1200,
        width: 1200,
        height: 1_000_000,
        x: 0,
        y: -y,
        toJSON: () => ({}),
      });
      await act(async () => {
        fireEvent.scroll(window);
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(grid.children.length).toBeLessThan(80);
    }

    // Rapid filter switch: alb-a (slow) -> alb-b (fast), then late alb-a arrives
    await act(async () => {
      fireEvent.change(screen.getByTestId('filter-album-select'), { target: { value: 'alb-a' } });
      fireEvent.change(screen.getByTestId('filter-album-select'), { target: { value: 'alb-b' } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Resolve stale alb-a response late
    for (const p of pendingResolvers) {
      p.resolve({
        total: 500,
        offset: 0,
        limit: 40,
        items: makeBatch('alba', 0, 40, 500),
      });
    }
    await flushMicrotasks();

    expect(screen.getByTestId('gallery-total-count').textContent).toContain('3');
    expect(screen.getByTestId('grid-card-albb-0')).toBeTruthy();
    expect(screen.queryByTestId('grid-card-alba-0')).toBeNull();
  });

  it('recovers cleanly in GalleryView when initial network fetch fails and user clicks retry', async () => {
    let attempts = 0;
    const store = createGalleryStore({
      fetchFilters: vi.fn(async () => ({ albums: [], tags: [], totalImages: 2 })),
      fetchImages: vi.fn(async ({ offset = 0, limit = 40 }) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('일시적인 네트워크 오류');
        }
        return {
          total: 2,
          offset,
          limit,
          items: makeBatch('ok', offset, 2, 2),
        };
      }),
    });

    render(<GalleryView isAdmin={false} store={store} />);
    await flushMicrotasks();

    expect(screen.getByTestId('gallery-error').textContent).toContain('일시적인 네트워크 오류');

    await act(async () => {
      fireEvent.click(screen.getByTestId('gallery-retry-button'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('gallery-error')).toBeNull();
    expect(screen.getByTestId('grid-card-ok-0')).toBeTruthy();
  });

  it('handles 0-image and 1-image PhotoFrameMode cleanly without errors or redundant preloads', async () => {
    vi.useFakeTimers();

    // 0-image album
    const preloadZero = vi.fn(async () => undefined);
    render(
      <PhotoFrameMode
        filter={{ albumId: 'empty-alb', tag: null }}
        onClose={vi.fn()}
        fetchIds={vi.fn(async (): Promise<FrameIdsResponse> => ({ total: 0, items: [] }))}
        preloadImage={preloadZero}
      />
    );
    await flushMicrotasks();

    expect(screen.getByTestId('frame-empty')).toBeTruthy();
    expect((screen.getByTestId('frame-play-pause') as HTMLButtonElement).disabled).toBe(true);
    expect(preloadZero).not.toHaveBeenCalled();

    cleanup();

    // 1-image album: displays single image steadily, advancing 60s triggers zero additional preloads
    const preloadOne = vi.fn(async () => undefined);
    render(
      <PhotoFrameMode
        filter={{ albumId: 'solo-alb', tag: null }}
        onClose={vi.fn()}
        fetchIds={vi.fn(async (): Promise<FrameIdsResponse> => ({
          total: 1,
          items: [
            {
              id: 'solo-1',
              caption: 'Single Photo',
              takenAt: 1_700_000_000_000,
              width: 1600,
              height: 1200,
              displayUrl: '/api/media/display/solo-1',
            },
          ],
        }))}
        preloadImage={preloadOne}
      />
    );
    await flushMicrotasks();

    expect(screen.getByTestId('frame-layer-a').getAttribute('data-active')).toBe('true');
    expect(preloadOne).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(preloadOne).toHaveBeenCalledTimes(1);
  });

  it('recovers PhotoFrameMode playback when user clicks retry after consecutive preload errors', async () => {
    vi.useFakeTimers();

    let shouldFail = false;
    const preloadImage = vi.fn(async () => {
      if (shouldFail) {
        throw new Error('offline');
      }
    });

    const items = [0, 1, 2, 3].map((i) => ({
      id: `rec-${i}`,
      caption: `Photo ${i}`,
      takenAt: 1_700_000_000_000 + i * 1000,
      width: 1600,
      height: 1200,
      displayUrl: `/api/media/display/rec-${i}`,
    }));

    render(
      <PhotoFrameMode
        filter={{ albumId: null, tag: null }}
        onClose={vi.fn()}
        fetchIds={vi.fn(async (): Promise<FrameIdsResponse> => ({ total: 4, items }))}
        preloadImage={preloadImage}
      />
    );
    await flushMicrotasks();

    // Cause 3 consecutive failures -> pauses with toast
    shouldFail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('frame-error-toast')).toBeTruthy();

    // Restore network and click retry -> clears toast and resumes playback
    shouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByTestId('frame-error-retry'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('frame-error-toast')).toBeNull();
    expect(screen.getByTestId('frame-play-pause').textContent).toBe('일시정지');
    expect(screen.getByTestId('frame-layer-b').getAttribute('data-active')).toBe('true');
  });
});
