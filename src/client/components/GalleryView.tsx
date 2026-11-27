import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import {
  type GalleryFilter,
  type GalleryStore,
  createGalleryStore,
} from '@/client/stores/galleryStore';
import { FilterBar } from './FilterBar';
import { LightboxModal } from './LightboxModal';
import { PhotoFrameMode } from './PhotoFrameMode';
import { VirtualGrid } from './VirtualGrid';

export interface GalleryViewProps {
  isAdmin: boolean;
  onGoAdmin?: () => void;
  onEnterFrameMode?: (filter: GalleryFilter) => void;
  store?: GalleryStore;
}

export const GalleryView = mount<GalleryViewProps>((renew, initialProps) => {
  let latestProps = initialProps;
  const ownsStore = !initialProps.store;
  const store = initialProps.store ?? createGalleryStore();

  const lightboxIndex = state<number | null>(null, renew);
  const frameModeFilter = state<GalleryFilter | null>(null, renew);

  const resetScrollTop = () => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        window.scrollTo(0, 0);
      }
    }
  };

  const applyFilter = (next: Partial<GalleryFilter>) => {
    lightboxIndex.value = null;
    frameModeFilter.value = null;
    resetScrollTop();
    void store.setFilter(next);
  };

  const handleOpenLightbox = (index: number) => {
    lightboxIndex.value = index;
    void store.ensureIndex(index);
  };

  const handleNavigateLightbox = (nextIndex: number) => {
    const snap = store.getSnapshot();
    if (nextIndex < 0 || nextIndex >= snap.total) return;
    lightboxIndex.value = nextIndex;
    void store.ensureIndex(nextIndex);
  };

  const openFrameModeWithFilter = (targetFilter: GalleryFilter) => {
    if (latestProps.onEnterFrameMode) {
      latestProps.onEnterFrameMode(targetFilter);
    } else {
      lightboxIndex.value = null;
      frameModeFilter.value = { ...targetFilter };
    }
  };

  const handleEnterFrameMode = () => {
    openFrameModeWithFilter(store.getSnapshot().filter);
  };

  const handleStartYearFrame = (year: number) => {
    const snap = store.getSnapshot();
    openFrameModeWithFilter({ ...snap.filter, year });
  };

  mountCallback(() => {
    const unsubscribe = store.subscribe(() => {
      renew();
    });

    void store.loadFilters();
    void store.ensureChunks([0]);

    return () => {
      unsubscribe();
      if (ownsStore) {
        store.dispose();
      }
    };
  });

  return (props) => {
    latestProps = props;
    const snap = store.getSnapshot();
    const hasFilter =
      snap.filter.albumId !== null || snap.filter.tag !== null || snap.filter.year !== null;
    const openIndex = lightboxIndex.value;
    const activeFrameFilter = frameModeFilter.value;

    const buildFilterLabel = (f: GalleryFilter): string => {
      const albumName =
        f.albumId === '__unassigned__'
          ? '미분류'
          : (snap.albums.find((a) => a.id === f.albumId)?.name ?? null);
      const parts: string[] = [];
      if (albumName) parts.push(albumName);
      if (f.year !== null && f.year !== undefined) parts.push(`${f.year}년`);
      if (f.tag) parts.push(`#${f.tag}`);
      return parts.length > 0 ? parts.join(' · ') : '전체 사진';
    };

    return (
      <section data-testid="gallery-view" class="space-y-5">
        <FilterBar
          albums={snap.albums}
          tags={snap.tags}
          years={snap.availableYears.length > 0 ? snap.availableYears : snap.years}
          selectedAlbumId={snap.filter.albumId}
          selectedTag={snap.filter.tag}
          selectedYear={snap.filter.year}
          filteredTotal={snap.total}
          totalAllImages={snap.totalAllImages}
          isAdmin={props.isAdmin}
          onSelectAlbum={(albumId) => applyFilter({ albumId })}
          onSelectTag={(tag) => applyFilter({ tag })}
          onSelectYear={(year) => applyFilter({ year })}
          onClearFilters={() => applyFilter({ albumId: null, tag: null, year: null })}
          onEnterFrameMode={handleEnterFrameMode}
          onGoAdmin={props.onGoAdmin}
        />

        {snap.error && (
          <div
            role="alert"
            data-testid="gallery-error"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
          >
            <span>{snap.error}</span>
            <button
              type="button"
              data-testid="gallery-retry-button"
              onClick={() => void store.retry()}
              class="rounded-lg border border-rose-400/40 bg-rose-900/60 px-3 py-1 text-xs font-medium text-white hover:bg-rose-800/70"
            >
              다시 시도
            </button>
          </div>
        )}

        {!snap.initialLoaded && !snap.error ? (
          <div
            data-testid="gallery-initial-loading"
            class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          >
            {Array.from({ length: 12 }, (_, idx) => (
              <div
                key={`init-skeleton-${idx}`}
                class="aspect-square rounded-xl border border-neutral-800/80 bg-neutral-900/70 animate-pulse"
              />
            ))}
          </div>
        ) : snap.total === 0 ? (
          <div
            data-testid="gallery-empty"
            class="rounded-2xl border border-neutral-800 bg-neutral-900/50 px-6 py-16 text-center"
          >
            <p class="text-base font-medium text-white">
              {hasFilter
                ? '선택한 필터 조건에 맞는 사진이 없습니다.'
                : '아직 업로드된 사진이 없습니다.'}
            </p>
            <p class="mt-2 text-sm text-neutral-400">
              {hasFilter
                ? '필터를 초기화하거나 다른 앨범·태그를 선택해 보세요.'
                : props.isAdmin
                  ? '관리자 페이지에서 첫 사진을 업로드해 보세요.'
                  : '관리자가 사진을 업로드하면 여기에 최신순으로 표시됩니다.'}
            </p>
            <div class="mt-5 flex items-center justify-center gap-2">
              {hasFilter && (
                <button
                  type="button"
                  onClick={() => applyFilter({ albumId: null, tag: null, year: null })}
                  class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  필터 초기화
                </button>
              )}
              {!hasFilter && props.isAdmin && props.onGoAdmin && (
                <button
                  type="button"
                  onClick={props.onGoAdmin}
                  class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200"
                >
                  사진 업로드하러 가기
                </button>
              )}
            </div>
          </div>
        ) : (
          <VirtualGrid
            total={snap.total}
            years={snap.years}
            resetKey={snap.generation}
            getItem={store.getItem}
            onVisibleChunksChange={(chunkIndices) => {
              void store.ensureChunks(chunkIndices);
            }}
            onSelectItem={handleOpenLightbox}
            onStartYearFrame={handleStartYearFrame}
          />
        )}

        <LightboxModal
          open={openIndex !== null}
          currentIndex={openIndex ?? 0}
          total={snap.total}
          item={openIndex !== null ? store.getItem(openIndex) : undefined}
          prevItem={openIndex !== null && openIndex > 0 ? store.getItem(openIndex - 1) : undefined}
          nextItem={
            openIndex !== null && openIndex < snap.total - 1
              ? store.getItem(openIndex + 1)
              : undefined
          }
          onClose={() => {
            lightboxIndex.value = null;
          }}
          onNavigate={handleNavigateLightbox}
        />

        {activeFrameFilter && (
          <PhotoFrameMode
            filter={activeFrameFilter}
            filterLabel={buildFilterLabel(activeFrameFilter)}
            onClose={() => {
              frameModeFilter.value = null;
            }}
          />
        )}
      </section>
    );
  };
});
