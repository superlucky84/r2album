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

  it('renders year section headers and year quick-jump bar when years metadata is provided', async () => {
    const loadedMap = new Map<number, ImageItem>([
      [0, makeItem(0)],
      [1, makeItem(1)],
      [2, makeItem(2)],
    ]);
    const onVisibleChunksChange = vi.fn();
    const onStartYearFrame = vi.fn();

    render(
      <VirtualGrid
        total={3}
        years={[
          { year: 2026, count: 1 },
          { year: 2025, count: 2 },
        ]}
        resetKey={0}
        getItem={(idx) => loadedMap.get(idx)}
        onVisibleChunksChange={onVisibleChunksChange}
        onSelectItem={vi.fn()}
        onStartYearFrame={onStartYearFrame}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('sticky-year-bar')).toBeTruthy();
    expect(screen.getByTestId('year-jump-bar')).toBeTruthy();
    expect(screen.getByTestId('year-jump-2026').textContent).toContain('2026년');
    expect(screen.getByTestId('year-jump-2025').textContent).toContain('2025년');
    expect(screen.getByTestId('year-header-2026').textContent).toContain('2026년');
    expect(screen.getByTestId('year-header-2025').textContent).toContain('2025년');
    expect(screen.getByTestId('sticky-year-frame-button').textContent).toContain('2026년 액자');

    // Selecting 2025 in sticky year select scrolls and updates sticky frame button to 2025
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    await act(() => {
      fireEvent.change(screen.getByTestId('sticky-year-select'), { target: { value: '2025' } });
    });
    expect(scrollToSpy).toHaveBeenCalled();
    expect(screen.getByTestId('sticky-year-frame-button').textContent).toContain('2025년 액자');

    // Clicking sticky year frame button launches Photo Frame for active year (2025)
    await act(() => {
      fireEvent.click(screen.getByTestId('sticky-year-frame-button'));
    });
    expect(onStartYearFrame).toHaveBeenCalledWith(2025);

    // Clicking in-grid section header's frame button also still triggers onStartYearFrame(year)
    await act(() => {
      fireEvent.click(screen.getByTestId('year-frame-2025'));
    });
    expect(onStartYearFrame).toHaveBeenCalledTimes(2);
  });
});
