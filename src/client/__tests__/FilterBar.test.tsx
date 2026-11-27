// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { AlbumSummary, TagSummary } from '@/shared/types';
import { FilterBar } from '../components/FilterBar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ALBUMS: AlbumSummary[] = [
  { id: 'alb-1', name: '제주 여행', description: '', imageCount: 15, createdAt: 1, updatedAt: 1 },
];
const TAGS: TagSummary[] = [
  { id: 1, name: '바다', imageCount: 8 },
  { id: 2, name: '가족', imageCount: 12 },
];

describe('FilterBar component', () => {
  it('handles album selection, tag chip toggle, clear filters, and admin link visibility', async () => {
    const onSelectAlbum = vi.fn();
    const onSelectTag = vi.fn();
    const onSelectYear = vi.fn();
    const onClearFilters = vi.fn();
    const onEnterFrameMode = vi.fn();
    const onGoAdmin = vi.fn();

    render(
      <FilterBar
        albums={ALBUMS}
        tags={TAGS}
        years={[
          { year: 2026, count: 30 },
          { year: 2025, count: 20 },
        ]}
        selectedAlbumId="alb-1"
        selectedTag="바다"
        selectedYear={2026}
        filteredTotal={8}
        totalAllImages={50}
        isAdmin={true}
        onSelectAlbum={onSelectAlbum}
        onSelectTag={onSelectTag}
        onSelectYear={onSelectYear}
        onClearFilters={onClearFilters}
        onEnterFrameMode={onEnterFrameMode}
        onGoAdmin={onGoAdmin}
      />
    );

    expect(screen.getByTestId('gallery-total-count').textContent).toContain('8');
    expect(screen.getByTestId('filterbar-admin-link')).toBeTruthy();

    await act(() => {
      fireEvent.change(screen.getByTestId('filter-album-select'), { target: { value: '' } });
      fireEvent.change(screen.getByTestId('filter-year-select'), { target: { value: '2025' } });
      fireEvent.click(screen.getByTestId('filter-tag-가족'));
      fireEvent.click(screen.getByTestId('filter-tag-바다')); // active -> toggles off (null)
      fireEvent.click(screen.getByTestId('filter-clear-button'));
      fireEvent.click(screen.getByTestId('frame-mode-button'));
      fireEvent.click(screen.getByTestId('filterbar-admin-link'));
    });

    expect(onSelectAlbum).toHaveBeenCalledWith(null);
    expect(onSelectYear).toHaveBeenCalledWith(2025);
    expect(onSelectTag).toHaveBeenNthCalledWith(1, '가족');
    expect(onSelectTag).toHaveBeenNthCalledWith(2, null);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onEnterFrameMode).toHaveBeenCalledTimes(1);
    expect(onGoAdmin).toHaveBeenCalledTimes(1);
  });

  it('hides admin link for viewer and disables frame mode when filteredTotal is 0', () => {
    render(
      <FilterBar
        albums={ALBUMS}
        tags={TAGS}
        selectedAlbumId={null}
        selectedTag={null}
        filteredTotal={0}
        totalAllImages={0}
        isAdmin={false}
        onSelectAlbum={vi.fn()}
        onSelectTag={vi.fn()}
        onClearFilters={vi.fn()}
        onEnterFrameMode={vi.fn()}
        onGoAdmin={vi.fn()}
      />
    );

    expect(screen.queryByTestId('filterbar-admin-link')).toBeNull();
    expect(screen.queryByTestId('filter-clear-button')).toBeNull();
    expect((screen.getByTestId('frame-mode-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
