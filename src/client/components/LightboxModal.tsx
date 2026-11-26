import { mount, mountCallback } from 'lithent';
import type { ImageItem } from '@/shared/types';
import { formatDateTime } from '@/client/lib/format';

export interface LightboxModalProps {
  open: boolean;
  currentIndex: number;
  total: number;
  item: ImageItem | undefined;
  prevItem?: ImageItem;
  nextItem?: ImageItem;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}

const SWIPE_THRESHOLD_PX = 40;

export const LightboxModal = mount<LightboxModalProps>((_renew, initialProps) => {
  let latestProps = initialProps;
  let touchStartX: number | null = null;
  let touchStartY: number | null = null;
  let previousBodyOverflow: string | null = null;
  let bodyLocked = false;
  const preloadedUrls = new Set<string>();

  const preloadUrl = (url: string | undefined) => {
    if (!url || preloadedUrls.has(url) || typeof Image === 'undefined') return;
    preloadedUrls.add(url);
    const img = new Image();
    img.src = url;
  };

  const lockBodyScroll = () => {
    if (bodyLocked || typeof document === 'undefined') return;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    bodyLocked = true;
  };

  const unlockBodyScroll = () => {
    if (!bodyLocked || typeof document === 'undefined') return;
    document.body.style.overflow = previousBodyOverflow ?? '';
    previousBodyOverflow = null;
    bodyLocked = false;
  };

  const goPrev = () => {
    if (latestProps.currentIndex > 0) {
      latestProps.onNavigate(latestProps.currentIndex - 1);
    }
  };

  const goNext = () => {
    if (latestProps.currentIndex < latestProps.total - 1) {
      latestProps.onNavigate(latestProps.currentIndex + 1);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!latestProps.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      latestProps.onClose();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches?.[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (touchStartX === null || touchStartY === null) return;
    const touch = e.changedTouches?.[0];
    const startX = touchStartX;
    const startY = touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        goNext();
      } else {
        goPrev();
      }
    }
  };

  mountCallback(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();
    };
  });

  return (props) => {
    latestProps = props;

    if (!props.open) {
      unlockBodyScroll();
      return null;
    }

    lockBodyScroll();
    preloadUrl(props.nextItem?.displayUrl);
    preloadUrl(props.prevItem?.displayUrl);

    const hasPrev = props.currentIndex > 0;
    const hasNext = props.currentIndex < props.total - 1;
    const item = props.item;

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="사진 상세 보기"
        data-testid="lightbox-modal"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        class="fixed inset-0 z-50 flex flex-col bg-black/95 text-white backdrop-blur-sm"
      >
        {/* Top bar */}
        <div class="flex items-center justify-between border-b border-neutral-800/80 px-4 py-3 sm:px-6">
          <span data-testid="lightbox-counter" class="text-sm font-medium text-neutral-300">
            {props.currentIndex + 1} / {props.total.toLocaleString()}
          </span>
          <button
            type="button"
            data-testid="lightbox-close"
            onClick={() => latestProps.onClose()}
            class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-800 hover:text-white"
          >
            닫기 (ESC)
          </button>
        </div>

        {/* Image viewport */}
        <div
          class="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8"
          onClick={(e: Event) => {
            if (e.target === e.currentTarget) {
              latestProps.onClose();
            }
          }}
        >
          <button
            type="button"
            aria-label="이전 사진"
            disabled={!hasPrev}
            data-testid="lightbox-prev"
            onClick={goPrev}
            class="absolute left-3 z-10 rounded-full border border-neutral-700/80 bg-black/70 px-3.5 py-2.5 text-lg text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-25 sm:left-6"
          >
            ‹
          </button>

          {item ? (
            <img
              key={item.id}
              data-testid="lightbox-image"
              src={item.displayUrl}
              alt={item.caption || '상세 사진'}
              class="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
          ) : (
            <div
              data-testid="lightbox-loading"
              class="flex items-center gap-2 text-sm text-neutral-400"
            >
              <span class="h-2.5 w-2.5 rounded-full bg-neutral-400 animate-pulse" />
              <span>사진 정보를 불러오는 중...</span>
            </div>
          )}

          <button
            type="button"
            aria-label="다음 사진"
            disabled={!hasNext}
            data-testid="lightbox-next"
            onClick={goNext}
            class="absolute right-3 z-10 rounded-full border border-neutral-700/80 bg-black/70 px-3.5 py-2.5 text-lg text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-25 sm:right-6"
          >
            ›
          </button>
        </div>

        {/* Metadata footer */}
        {item && (
          <div
            data-testid="lightbox-meta"
            class="border-t border-neutral-800/80 bg-neutral-950/90 px-4 py-3.5 sm:px-6"
          >
            <div class="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1 space-y-1">
                {item.caption && (
                  <p data-testid="lightbox-caption" class="text-sm font-medium text-white">
                    {item.caption}
                  </p>
                )}
                <div class="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <span>
                    {item.hasExifDate ? '촬영일' : '업로드일'}: {formatDateTime(item.takenAt)}
                  </span>
                  {item.hasExifDate && (
                    <span class="text-neutral-500">
                      (업로드: {formatDateTime(item.uploadedAt)})
                    </span>
                  )}
                  <span class="text-neutral-500">
                    {item.width}×{item.height}
                  </span>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 text-xs">
                <span class="rounded-md bg-neutral-800 px-2.5 py-1 text-neutral-200">
                  {item.albumName ?? '미분류'}
                </span>
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    class="rounded-md bg-sky-950/80 px-2.5 py-1 text-sky-300 border border-sky-800/50"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };
});
