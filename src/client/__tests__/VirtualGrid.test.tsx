// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { ImageItem } from '@/shared/types';
import { VirtualGrid } from '../components/VirtualGrid';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeItem(index: number): ImageItem {
  return {
    id: `photo-${index}`,
    albumId: 'alb-1',
    albumName: '제주 여행',
    caption: `사진 ${index}`,
    tags: ['바다'],
    takenAt: new Date(2026, 4, 10, 12, 0).getTime(),
    hasExifDate: true,
    uploadedAt: new Date(2026, 4, 10, 12, 0).getTime(),
    width: 2048,
    height: 1536,
    thumbUrl: `/api/media/thumb/photo-${index}`,
    displayUrl: `/api/media/display/photo-${index}`,
  };
}

describe('VirtualGrid component', () => {
  it('keeps DOM node count bounded for 30,000 items, renders skeletons & cards, and handles clicks', async () => {
    const onVisibleChunksChange = vi.fn();
    const onSelectItem = vi.fn();

    // Only index 0 and 1 are loaded; remaining visible slots should show skeletons
    const loadedMap = new Map<number, ImageItem>([
      [0, makeItem(0)],
      [1, makeItem(1)],
    ]);

    render(
      <VirtualGrid
        total={30_000}
        resetKey={0}
        getItem={(idx) => loadedMap.get(idx)}
        onVisibleChunksChange={onVisibleChunksChange}
        onSelectItem={onSelectItem}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const grid = screen.getByTestId('virtual-grid');
    // Total rendered cards (loaded + skeletons) must stay small despite 30,000 items
    expect(grid.children.length).toBeGreaterThan(2);
    expect(grid.children.length).toBeLessThan(80);

    // Loaded card shows EXIF short date badge and opens on click
    const card0 = screen.getByTestId('grid-card-photo-0');
    expect(card0.textContent).toContain('2026.05.10');
    expect(screen.getAllByTestId('grid-skeleton-card').length).toBeGreaterThan(0);

    await act(() => {
      fireEvent.click(card0);
    });
    expect(onSelectItem).toHaveBeenCalledWith(0);
    expect(onVisibleChunksChange).toHaveBeenCalledWith(expect.arrayContaining([0]));
  });
});
