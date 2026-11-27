import { mount, mountCallback, ref } from 'lithent';
import { state } from 'lithent/helper';
import type { ImageItem, YearGroupSummary } from '@/shared/types';
import { formatShortDate } from '@/client/lib/format';
import { computeVirtualGridLayout } from '@/client/lib/virtualGrid';

export interface VirtualGridProps {
  total: number;
  years?: YearGroupSummary[];
  resetKey: number;
  getItem: (index: number) => ImageItem | undefined;
  onVisibleChunksChange: (chunkIndices: number[]) => void;
  onSelectItem: (index: number) => void;
  onStartYearFrame?: (year: number) => void;
}

export const VirtualGrid = mount<VirtualGridProps>((renew, initialProps) => {
  let latestProps = initialProps;
  let lastResetKey = initialProps.resetKey;
  let lastChunkSignature = '';
  let rafId: number | null = null;

  const containerRef = ref<HTMLDivElement | null>(null);
  const containerWidth = state<number>(
    typeof window !== 'undefined' ? Math.min(1232, Math.max(320, window.innerWidth - 48)) : 1024,
    renew
  );
  const viewportHeight = state<number>(
    typeof window !== 'undefined' ? window.innerHeight || 800 : 800,
    renew
  );
  const scrollTop = state<number>(0, renew);

  const measureAndSync = () => {
    rafId = null;
    if (typeof window === 'undefined') return;

    const el = containerRef.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && Math.round(rect.width) !== containerWidth.value) {
        containerWidth.value = Math.round(rect.width);
      }
      const relativeScroll = Math.max(0, Math.round(-rect.top));
      if (relativeScroll !== scrollTop.value) {
        scrollTop.value = relativeScroll;
      }
    } else {
      const y = Math.max(0, Math.round(window.scrollY || 0));
      if (y !== scrollTop.value) {
        scrollTop.value = y;
      }
    }

    const vh = window.innerHeight || 800;
    if (vh !== viewportHeight.value) {
      viewportHeight.value = vh;
    }
  };

  const scheduleMeasure = () => {
    if (typeof window === 'undefined') return;
    if (rafId !== null) return;
    if (typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(measureAndSync);
    } else {
      measureAndSync();
    }
  };

  const scrollToYearOffset = (headerTop: number) => {
    if (typeof window === 'undefined') return;
    const el = containerRef.value;
    const stickyHeaderOffset = 72;
    const gridPageTop = el ? window.scrollY + el.getBoundingClientRect().top : 0;
    const targetY = Math.max(0, Math.round(gridPageTop + headerTop - stickyHeaderOffset));

    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, targetY);
      }
    }
    scrollTop.value = Math.max(0, Math.round(headerTop));
  };

  mountCallback(() => {
    measureAndSync();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      resizeObserver.observe(containerRef.value);
    }

    window.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure, { passive: true });

    return () => {
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      resizeObserver?.disconnect();
      window.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  });

  return (props) => {
    latestProps = props;

    if (props.resetKey !== lastResetKey) {
      lastResetKey = props.resetKey;
      lastChunkSignature = '';
      if (scrollTop.value !== 0) {
        scrollTop.value = 0;
      }
    }

    const layout = computeVirtualGridLayout({
      total: props.total,
      years: props.years,
      containerWidth: containerWidth.value,
      viewportHeight: viewportHeight.value,
      scrollTop: scrollTop.value,
    });

    const nextChunkSignature = `${props.resetKey}:${props.total}:${layout.chunkIndices.join(',')}`;
    if (layout.chunkIndices.length > 0 && nextChunkSignature !== lastChunkSignature) {
      lastChunkSignature = nextChunkSignature;
      queueMicrotask(() => {
        latestProps.onVisibleChunksChange(layout.chunkIndices);
      });
    }

    // Highlight the year currently intersecting the top of the viewport
    let activeYear: number | null = null;
    if (layout.yearSections.length > 0) {
      activeYear = layout.yearSections[0].year;
      for (const sec of layout.yearSections) {
        if (sec.headerTop <= scrollTop.value + 40) {
          activeYear = sec.year;
        } else {
          break;
        }
      }
    }

    return (
      <div class="space-y-3">
        {layout.yearSections.length > 1 && (
          <nav
            aria-label="연도 바로가기"
            data-testid="year-jump-bar"
            class="flex flex-wrap items-center gap-1.5"
          >
            <span class="mr-1 text-xs font-medium text-neutral-400">연도 바로가기</span>
            {layout.yearSections.map((sec) => {
              const isActive = activeYear === sec.year;
              return (
                <button
                  key={`jump-${sec.year}`}
                  type="button"
                  data-testid={`year-jump-${sec.year}`}
                  onClick={() => scrollToYearOffset(sec.headerTop)}
                  class={
                    isActive
                      ? 'rounded-full border border-white/40 bg-white px-3 py-1 text-xs font-semibold text-neutral-950 transition'
                      : 'rounded-full border border-neutral-800 bg-neutral-900/80 px-3 py-1 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white'
                  }
                >
                  {sec.year}년 <span class="opacity-65">({sec.count.toLocaleString()})</span>
                </button>
              );
            })}
          </nav>
        )}

        <div
          ref={containerRef}
          data-testid="virtual-grid"
          class="relative w-full"
          style={{ height: `${layout.totalHeight}px` }}
        >
          {layout.visibleHeaders.map((header) => (
            <div
              key={`year-header-${header.year}`}
              data-testid={`year-header-${header.year}`}
              style={{
                position: 'absolute',
                left: '0px',
                right: '0px',
                top: '0px',
                height: `${header.height}px`,
                transform: `translate3d(0px, ${header.top}px, 0)`,
              }}
              class="flex items-center gap-3 pb-2"
            >
              <h2 class="text-lg font-semibold tracking-tight text-white">{header.year}년</h2>
              <span class="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-0.5 text-xs text-neutral-400">
                {header.count.toLocaleString()}장
              </span>
              <div class="h-px flex-1 bg-neutral-800/80" />
              {props.onStartYearFrame && (
                <button
                  type="button"
                  data-testid={`year-frame-${header.year}`}
                  onClick={() => latestProps.onStartYearFrame?.(header.year)}
                  class="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
                >
                  {header.year}년 액자
                </button>
              )}
            </div>
          ))}

          {layout.visibleCells.map((cell) => {
            const { index, left, top } = cell;
            const item = props.getItem(index);

            if (!item) {
              return (
                <div
                  key={`skeleton-${index}`}
                  data-testid="grid-skeleton-card"
                  style={{
                    position: 'absolute',
                    left: '0px',
                    top: '0px',
                    width: `${layout.itemWidth}px`,
                    height: `${layout.itemHeight}px`,
                    transform: `translate3d(${left}px, ${top}px, 0)`,
                  }}
                  class="overflow-hidden rounded-xl border border-neutral-800/80 bg-neutral-900/70 animate-pulse"
                />
              );
            }

            const shortDate = formatShortDate(item.takenAt);

            return (
              <button
                key={item.id}
                type="button"
                data-testid={`grid-card-${item.id}`}
                onClick={() => latestProps.onSelectItem(index)}
                style={{
                  position: 'absolute',
                  left: '0px',
                  top: '0px',
                  width: `${layout.itemWidth}px`,
                  height: `${layout.itemHeight}px`,
                  transform: `translate3d(${left}px, ${top}px, 0)`,
                }}
                class="group overflow-hidden rounded-xl border border-neutral-800/90 bg-neutral-900 text-left focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <img
                  src={item.thumbUrl}
                  alt={item.caption || `사진 ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                  class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
                {shortDate && (
                  <span
                    data-testid="card-date-badge"
                    class="pointer-events-none absolute top-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium text-neutral-100 backdrop-blur-xs"
                  >
                    {shortDate}
                  </span>
                )}
                {(item.caption || item.albumName) && (
                  <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pt-6 pb-2 opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
                    {item.caption && (
                      <p class="truncate text-xs font-medium text-white">{item.caption}</p>
                    )}
                    {item.albumName && (
                      <p class="truncate text-[11px] text-neutral-300">{item.albumName}</p>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
});
