import { lmount } from 'lithent';
import type { AlbumSummary, TagSummary, YearGroupSummary } from '@/shared/types';

export interface FilterBarProps {
  albums: AlbumSummary[];
  tags: TagSummary[];
  years?: YearGroupSummary[];
  selectedAlbumId: string | null;
  selectedTag: string | null;
  selectedYear?: number | null;
  filteredTotal: number;
  totalAllImages: number;
  isAdmin: boolean;
  onSelectAlbum: (albumId: string | null) => void;
  onSelectTag: (tag: string | null) => void;
  onSelectYear?: (year: number | null) => void;
  onClearFilters: () => void;
  onEnterFrameMode: () => void;
  onGoAdmin?: () => void;
}

export const FilterBar = lmount<FilterBarProps>(() => {
  return ({
    albums,
    tags,
    years = [],
    selectedAlbumId,
    selectedTag,
    selectedYear = null,
    filteredTotal,
    totalAllImages,
    isAdmin,
    onSelectAlbum,
    onSelectTag,
    onSelectYear,
    onClearFilters,
    onEnterFrameMode,
    onGoAdmin,
  }) => {
    const hasActiveFilter =
      selectedAlbumId !== null || selectedTag !== null || selectedYear !== null;

    return (
      <section
        data-testid="filter-bar"
        class="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="앨범 선택"
              data-testid="filter-album-select"
              value={selectedAlbumId ?? ''}
              onChange={(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                onSelectAlbum(val || null);
              }}
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
            >
              <option value="">전체 앨범 ({totalAllImages.toLocaleString()})</option>
              <option value="__unassigned__">미분류</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.name} ({album.imageCount})
                </option>
              ))}
            </select>

            {years.length > 0 && onSelectYear && (
              <select
                aria-label="연도 선택"
                data-testid="filter-year-select"
                value={selectedYear !== null ? String(selectedYear) : ''}
                onChange={(e: Event) => {
                  const val = (e.target as HTMLSelectElement).value;
                  onSelectYear(val ? Number.parseInt(val, 10) : null);
                }}
                class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
              >
                <option value="">전체 연도</option>
                {years.map((y) => (
                  <option key={y.year} value={String(y.year)}>
                    {y.year}년 ({y.count.toLocaleString()})
                  </option>
                ))}
              </select>
            )}

            <span data-testid="gallery-total-count" class="text-sm text-neutral-300">
              총 <strong class="font-semibold text-white">{filteredTotal.toLocaleString()}</strong>
              장
            </span>

            {hasActiveFilter && (
              <button
                type="button"
                data-testid="filter-clear-button"
                onClick={onClearFilters}
                class="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-700 hover:text-white"
              >
                필터 초기화
              </button>
            )}
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              disabled={filteredTotal === 0}
              data-testid="frame-mode-button"
              onClick={onEnterFrameMode}
              class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              액자 모드
            </button>
            {isAdmin && onGoAdmin && (
              <a
                href="/admin"
                data-testid="filterbar-admin-link"
                onClick={(e: Event) => {
                  e.preventDefault();
                  onGoAdmin();
                }}
                class="rounded-xl border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-600 hover:text-white"
              >
                관리자
              </a>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <div data-testid="filter-tag-list" class="flex flex-wrap items-center gap-1.5 pt-1">
            {tags.map((tag) => {
              const active = selectedTag === tag.name;
              return (
                <button
                  key={tag.id}
                  type="button"
                  data-testid={`filter-tag-${tag.name}`}
                  aria-pressed={active}
                  onClick={() => onSelectTag(active ? null : tag.name)}
                  class={
                    active
                      ? 'rounded-full border border-sky-400 bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-200 transition'
                      : 'rounded-full border border-neutral-800 bg-neutral-950/70 px-3 py-1 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white'
                  }
                >
                  #{tag.name} <span class="text-neutral-500">({tag.imageCount})</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  };
});
