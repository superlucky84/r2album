import { mount, mountCallback, ref } from 'lithent';
import { state } from 'lithent/helper';
import type { FrameIdsResponse, FrameItem } from '@/shared/types';
import { type FetchFrameIdsParams, fetchFrameIds } from '@/client/api/admin';
import { formatDateTime } from '@/client/lib/format';
import { type ShuffleQueue, createShuffleQueue } from '@/client/lib/shuffle';
import type { GalleryFilter } from '@/client/stores/galleryStore';

export type FrameOrderMode = 'newest' | 'oldest' | 'random';
export type FrameTransitionEffect = 'fade' | 'ken-burns';
export type FrameIntervalSeconds = 3 | 5 | 10 | 30;

export interface PhotoFrameModeProps {
  filter: GalleryFilter;
  filterLabel?: string;
  onClose: () => void;
  fetchIds?: (params: FetchFrameIdsParams, signal?: AbortSignal) => Promise<FrameIdsResponse>;
  preloadImage?: (url: string) => Promise<void>;
  rng?: () => number;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

const HUD_HIDE_DELAY_MS = 3000;
const MAX_CONSECUTIVE_PRELOAD_ERRORS = 3;
const INTERVAL_OPTIONS: FrameIntervalSeconds[] = [3, 5, 10, 30];

export function defaultPreloadImage(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof Image === 'undefined') {
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img
          .decode()
          .then(() => resolve())
          .catch(() => resolve());
      } else {
        resolve();
      }
    };
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    img.src = url;
  });
}

export const PhotoFrameMode = mount<PhotoFrameModeProps>((renew, initialProps) => {
  let latestProps = initialProps;
  let disposed = false;
  let transitionSeq = 0;
  let consecutiveErrors = 0;
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let hudTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeLock: WakeLockSentinelLike | null = null;
  let previousBodyOverflow: string | null = null;

  let items: FrameItem[] = [];
  let seqIndex = 0;
  let shuffleQueue: ShuffleQueue<FrameItem> | null = null;

  const containerRef = ref<HTMLDivElement | null>(null);

  const loading = state<boolean>(true, renew);
  const loadError = state<string | null>(null, renew);
  const toastMessage = state<string | null>(null, renew);
  const totalCount = state<number>(0, renew);

  const layerA = state<FrameItem | null>(null, renew);
  const layerB = state<FrameItem | null>(null, renew);
  const activeLayer = state<'A' | 'B' | null>(null, renew);
  const layerASlideKey = state<number>(0, renew);
  const layerBSlideKey = state<number>(0, renew);

  const playing = state<boolean>(true, renew);
  const orderMode = state<FrameOrderMode>('newest', renew);
  const intervalSec = state<FrameIntervalSeconds>(5, renew);
  const effect = state<FrameTransitionEffect>('ken-burns', renew);
  const showOverlayMeta = state<boolean>(true, renew);
  const hudVisible = state<boolean>(true, renew);
  const isFullscreen = state<boolean>(false, renew);

  const clearAdvanceTimer = () => {
    if (advanceTimer !== null) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  };

  const clearHudTimer = () => {
    if (hudTimer !== null) {
      clearTimeout(hudTimer);
      hudTimer = null;
    }
  };

  const scheduleHudAutoHide = () => {
    clearHudTimer();
    hudTimer = setTimeout(() => {
      if (!disposed) {
        hudVisible.value = false;
      }
    }, HUD_HIDE_DELAY_MS);
  };

  const wakeHud = () => {
    if (disposed) return;
    if (!hudVisible.value) {
      hudVisible.value = true;
    }
    scheduleHudAutoHide();
  };

  const getSequentialItems = (): FrameItem[] => {
    if (orderMode.value === 'oldest') {
      return items.slice().reverse();
    }
    return items;
  };

  const pickNextItem = (direction: 1 | -1): FrameItem | null => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];

    if (orderMode.value === 'random') {
      if (!shuffleQueue) {
        shuffleQueue = createShuffleQueue(items, latestProps.rng);
      }
      return direction === 1 ? shuffleQueue.next() : shuffleQueue.prev();
    }

    const ordered = getSequentialItems();
    seqIndex = (seqIndex + direction + ordered.length) % ordered.length;
    return ordered[seqIndex];
  };

  const scheduleNextAdvance = () => {
    clearAdvanceTimer();
    if (disposed || !playing.value || items.length <= 1) return;
    advanceTimer = setTimeout(() => {
      void transitionToDirection(1);
    }, intervalSec.value * 1000);
  };

  const displayItemWithPreload = async (
    candidate: FrameItem,
    directionOnFailure: 1 | -1
  ): Promise<void> => {
    const seq = ++transitionSeq;
    const doPreload = latestProps.preloadImage ?? defaultPreloadImage;

    try {
      await doPreload(candidate.displayUrl);
      if (disposed || seq !== transitionSeq) return;

      consecutiveErrors = 0;
      toastMessage.value = null;

      if (layerA.value === null && layerB.value === null) {
        layerA.value = candidate;
        layerASlideKey.value += 1;
        activeLayer.value = 'A';
      } else if (activeLayer.value === 'A') {
        layerB.value = candidate;
        layerBSlideKey.value += 1;
        activeLayer.value = 'B';
      } else {
        layerA.value = candidate;
        layerASlideKey.value += 1;
        activeLayer.value = 'A';
      }
      scheduleNextAdvance();
    } catch {
      if (disposed || seq !== transitionSeq) return;
      consecutiveErrors += 1;

      if (consecutiveErrors >= MAX_CONSECUTIVE_PRELOAD_ERRORS || items.length <= 1) {
        playing.value = false;
        clearAdvanceTimer();
        toastMessage.value =
          '이미지를 연속으로 불러오지 못해 재생을 일시정지했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
        return;
      }

      toastMessage.value = '일부 이미지를 불러오지 못해 다음 사진으로 건너뜁니다.';
      const fallbackNext = pickNextItem(directionOnFailure);
      if (fallbackNext) {
        await displayItemWithPreload(fallbackNext, directionOnFailure);
      }
    }
  };

  const transitionToDirection = async (direction: 1 | -1) => {
    clearAdvanceTimer();
    const nextItem = pickNextItem(direction);
    if (!nextItem) return;
    await displayItemWithPreload(nextItem, direction);
  };

  const requestWakeLock = async () => {
    const wakeLockApi =
      typeof navigator !== 'undefined'
        ? (navigator.wakeLock as
            { request?: (type: 'screen') => Promise<WakeLockSentinelLike> } | undefined)
        : undefined;
    if (!wakeLockApi?.request) return;
    try {
      const sentinel = await wakeLockApi.request('screen');
      if (disposed) {
        await sentinel.release().catch(() => undefined);
        return;
      }
      wakeLock = sentinel;
    } catch {
      // Safely ignore unsupported or denied Wake Lock
    }
  };

  const releaseWakeLock = () => {
    const current = wakeLock;
    wakeLock = null;
    if (current) {
      void current.release().catch(() => undefined);
    }
  };

  const enterFullscreen = () => {
    const target = containerRef.value ?? document.documentElement;
    if (target && typeof target.requestFullscreen === 'function') {
      void Promise.resolve(target.requestFullscreen())
        .then(() => {
          if (!disposed) isFullscreen.value = true;
        })
        .catch(() => undefined);
    }
  };

  const exitFullscreenIfActive = () => {
    if (
      typeof document !== 'undefined' &&
      document.fullscreenElement &&
      typeof document.exitFullscreen === 'function'
    ) {
      void Promise.resolve(document.exitFullscreen()).catch(() => undefined);
    }
  };

  const toggleFullscreen = () => {
    wakeHud();
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      exitFullscreenIfActive();
    } else {
      enterFullscreen();
    }
  };

  const handleTogglePlay = () => {
    wakeHud();
    if (items.length <= 1) return;
    playing.value = !playing.value;
    if (playing.value) {
      consecutiveErrors = 0;
      toastMessage.value = null;
      scheduleNextAdvance();
    } else {
      clearAdvanceTimer();
    }
  };

  const handleOrderChange = (nextOrder: FrameOrderMode) => {
    wakeHud();
    if (orderMode.value === nextOrder) return;
    orderMode.value = nextOrder;
    const activeItem =
      activeLayer.value === 'A' ? layerA.value : activeLayer.value === 'B' ? layerB.value : null;

    if (nextOrder === 'random') {
      shuffleQueue = createShuffleQueue(items, latestProps.rng);
    } else {
      const ordered = getSequentialItems();
      const idx = activeItem ? ordered.findIndex((i) => i.id === activeItem.id) : 0;
      seqIndex = idx >= 0 ? idx : 0;
    }

    if (playing.value) {
      scheduleNextAdvance();
    }
  };

  const handleIntervalChange = (nextSec: FrameIntervalSeconds) => {
    wakeHud();
    intervalSec.value = nextSec;
    if (playing.value) {
      scheduleNextAdvance();
    }
  };

  const handleRetryAfterError = () => {
    wakeHud();
    consecutiveErrors = 0;
    toastMessage.value = null;
    playing.value = true;
    void transitionToDirection(1);
  };

  const handleClose = () => {
    clearAdvanceTimer();
    clearHudTimer();
    releaseWakeLock();
    exitFullscreenIfActive();
    latestProps.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    wakeHud();
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === ' ') {
      e.preventDefault();
      handleTogglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      void transitionToDirection(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      void transitionToDirection(-1);
    }
  };

  const handleFullscreenChange = () => {
    if (!disposed && typeof document !== 'undefined') {
      isFullscreen.value = Boolean(document.fullscreenElement);
    }
  };

  const handleVisibilityChange = () => {
    if (!disposed && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      if (!wakeLock) {
        void requestWakeLock();
      }
    }
  };

  mountCallback(() => {
    const controller = new AbortController();

    if (typeof document !== 'undefined') {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    window.addEventListener('keydown', handleKeyDown);

    enterFullscreen();
    void requestWakeLock();
    scheduleHudAutoHide();

    const doFetchIds = latestProps.fetchIds ?? fetchFrameIds;
    const frameYear = latestProps.filter.year ?? undefined;
    void doFetchIds(
      {
        albumId: latestProps.filter.albumId ?? undefined,
        tag: latestProps.filter.tag ?? undefined,
        ...(frameYear !== undefined
          ? { year: frameYear, tzOffset: -new Date().getTimezoneOffset() }
          : {}),
      },
      controller.signal
    )
      .then(async (res) => {
        if (disposed) return;
        items = res.items;
        totalCount.value = res.total;
        loading.value = false;

        if (items.length === 0) return;

        seqIndex = 0;
        shuffleQueue = createShuffleQueue(items, latestProps.rng);
        await displayItemWithPreload(items[0], 1);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        loading.value = false;
        loadError.value =
          err instanceof Error ? err.message : '액자 재생 목록을 불러오지 못했습니다.';
      });

    return () => {
      disposed = true;
      transitionSeq += 1;
      controller.abort();
      clearAdvanceTimer();
      clearHudTimer();
      releaseWakeLock();
      exitFullscreenIfActive();

      window.removeEventListener('keydown', handleKeyDown);
      if (typeof document !== 'undefined') {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.body.style.overflow = previousBodyOverflow ?? '';
      }
    };
  });

  return (props) => {
    latestProps = props;
    const activeItem =
      activeLayer.value === 'A' ? layerA.value : activeLayer.value === 'B' ? layerB.value : null;
    const isKenBurns = effect.value === 'ken-burns';

    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="전체화면 액자 롤링 모드"
        data-testid="photo-frame-mode"
        onMouseMove={wakeHud}
        onPointerDown={wakeHud}
        onTouchStart={wakeHud}
        class="fixed inset-0 z-50 select-none overflow-hidden bg-black text-white"
      >
        {/* Double-buffered image layers (DC-8): keep both wrappers always mounted with a stable array child so Lithent preserves the layer divs for opacity transitions and honors img keys to restart Ken Burns */}
        <div class="relative h-full w-full">
          <div
            data-testid="frame-layer-a"
            data-active={activeLayer.value === 'A' ? 'true' : 'false'}
            aria-hidden={activeLayer.value === 'A' ? 'false' : 'true'}
            class={`absolute inset-0 flex items-center justify-center transition-opacity duration-[1200ms] ease-in-out ${
              activeLayer.value === 'A' ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
            }`}
          >
            {layerA.value
              ? [
                  <img
                    key={`a-${layerA.value.id}-${layerASlideKey.value}`}
                    src={layerA.value.displayUrl}
                    alt={layerA.value.caption || '액자 사진'}
                    class={`max-h-full max-w-full object-contain ${
                      isKenBurns ? 'r2-ken-burns-active' : ''
                    }`}
                  />,
                ]
              : []}
          </div>

          <div
            data-testid="frame-layer-b"
            data-active={activeLayer.value === 'B' ? 'true' : 'false'}
            aria-hidden={activeLayer.value === 'B' ? 'false' : 'true'}
            class={`absolute inset-0 flex items-center justify-center transition-opacity duration-[1200ms] ease-in-out ${
              activeLayer.value === 'B' ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
            }`}
          >
            {layerB.value
              ? [
                  <img
                    key={`b-${layerB.value.id}-${layerBSlideKey.value}`}
                    src={layerB.value.displayUrl}
                    alt={layerB.value.caption || '액자 사진'}
                    class={`max-h-full max-w-full object-contain ${
                      isKenBurns ? 'r2-ken-burns-active' : ''
                    }`}
                  />,
                ]
              : []}
          </div>

          {loading.value && (
            <div
              data-testid="frame-loading"
              class="absolute inset-0 z-20 flex items-center justify-center text-sm text-neutral-300"
            >
              액자 재생 목록을 준비하는 중...
            </div>
          )}

          {!loading.value && loadError.value && (
            <div
              role="alert"
              data-testid="frame-load-error"
              class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <p class="text-sm text-rose-300">{loadError.value}</p>
              <button
                type="button"
                onClick={handleClose}
                class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900"
              >
                갤러리로 돌아가기
              </button>
            </div>
          )}

          {!loading.value && !loadError.value && totalCount.value === 0 && (
            <div
              data-testid="frame-empty"
              class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <p class="text-base text-neutral-300">재생할 사진이 없습니다.</p>
              <button
                type="button"
                onClick={handleClose}
                class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900"
              >
                닫기
              </button>
            </div>
          )}
        </div>

        {/* Preload error toast */}
        {toastMessage.value && (
          <div
            role="status"
            data-testid="frame-error-toast"
            class="absolute top-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/40 bg-black/85 px-4 py-2.5 text-xs text-amber-200 backdrop-blur"
          >
            <span>{toastMessage.value}</span>
            {!playing.value && (
              <button
                type="button"
                data-testid="frame-error-retry"
                onClick={handleRetryAfterError}
                class="rounded-lg bg-amber-500 px-2.5 py-1 font-medium text-neutral-950 hover:bg-amber-400"
              >
                재시도
              </button>
            )}
          </div>
        )}

        {/* Caption & shooting date subtle overlay */}
        {showOverlayMeta.value && activeItem && (
          <div
            data-testid="frame-caption-overlay"
            class={`pointer-events-none absolute left-6 z-20 max-w-xl rounded-xl bg-black/45 px-4 py-2.5 backdrop-blur-xs transition-all duration-300 ${
              hudVisible.value ? 'bottom-24' : 'bottom-6'
            }`}
          >
            {activeItem.caption && (
              <p class="text-sm font-medium text-white drop-shadow">{activeItem.caption}</p>
            )}
            <p class="text-xs text-neutral-300">{formatDateTime(activeItem.takenAt)}</p>
          </div>
        )}

        {/* Top bar (auto-hides with HUD) */}
        <div
          data-testid="frame-hud-top"
          class={`absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-5 py-4 transition-opacity duration-300 ${
            hudVisible.value ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div class="flex items-center gap-2 text-xs text-neutral-200">
            <span class="rounded-full border border-white/20 bg-black/50 px-3 py-1 font-medium">
              {props.filterLabel || '전체 사진'}
            </span>
            <span class="text-neutral-400">{totalCount.value.toLocaleString()}장</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-testid="frame-fullscreen-toggle"
              onClick={toggleFullscreen}
              class="rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/15"
            >
              {isFullscreen.value ? '전체화면 해제' : '전체화면'}
            </button>
            <button
              type="button"
              data-testid="frame-close"
              onClick={handleClose}
              class="rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15"
            >
              닫기 (ESC)
            </button>
          </div>
        </div>

        {/* Bottom Control HUD (auto-hides after 3s idle) */}
        <div
          data-testid="frame-hud"
          data-visible={hudVisible.value ? 'true' : 'false'}
          class={`absolute inset-x-0 bottom-0 z-30 flex justify-center bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pt-8 pb-5 transition-opacity duration-300 ${
            hudVisible.value ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div class="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black/75 px-4 py-2.5 backdrop-blur-md">
            <button
              type="button"
              aria-label="이전 사진"
              data-testid="frame-prev"
              disabled={totalCount.value <= 1}
              onClick={() => {
                wakeHud();
                void transitionToDirection(-1);
              }}
              class="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/15 disabled:opacity-40"
            >
              이전
            </button>

            <button
              type="button"
              data-testid="frame-play-pause"
              disabled={totalCount.value <= 1}
              onClick={handleTogglePlay}
              class="rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-40"
            >
              {playing.value ? '일시정지' : '재생'}
            </button>

            <button
              type="button"
              aria-label="다음 사진"
              data-testid="frame-next"
              disabled={totalCount.value <= 1}
              onClick={() => {
                wakeHud();
                void transitionToDirection(1);
              }}
              class="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/15 disabled:opacity-40"
            >
              다음
            </button>

            <span class="mx-1 hidden h-5 w-px bg-white/15 sm:inline-block" />

            <select
              aria-label="재생 순서"
              data-testid="frame-order-select"
              value={orderMode.value}
              onChange={(e: Event) =>
                handleOrderChange((e.target as HTMLSelectElement).value as FrameOrderMode)
              }
              class="rounded-lg border border-white/15 bg-neutral-900 px-2.5 py-1.5 text-xs text-white"
            >
              <option value="newest">순차 (최신순)</option>
              <option value="oldest">순차 (오래된순)</option>
              <option value="random">랜덤 셔플</option>
            </select>

            <select
              aria-label="전환 간격"
              data-testid="frame-interval-select"
              value={String(intervalSec.value)}
              onChange={(e: Event) =>
                handleIntervalChange(
                  Number((e.target as HTMLSelectElement).value) as FrameIntervalSeconds
                )
              }
              class="rounded-lg border border-white/15 bg-neutral-900 px-2.5 py-1.5 text-xs text-white"
            >
              {INTERVAL_OPTIONS.map((sec) => (
                <option key={sec} value={String(sec)}>
                  {sec}초
                </option>
              ))}
            </select>

            <button
              type="button"
              data-testid="frame-effect-toggle"
              onClick={() => {
                wakeHud();
                effect.value = effect.value === 'fade' ? 'ken-burns' : 'fade';
              }}
              class={
                isKenBurns
                  ? 'rounded-lg border border-sky-400/60 bg-sky-500/20 px-2.5 py-1.5 text-xs text-sky-200'
                  : 'rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/15'
              }
            >
              {isKenBurns ? 'Fade + Ken Burns' : 'Fade'}
            </button>

            <button
              type="button"
              data-testid="frame-caption-toggle"
              onClick={() => {
                wakeHud();
                showOverlayMeta.value = !showOverlayMeta.value;
              }}
              class={
                showOverlayMeta.value
                  ? 'rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-1.5 text-xs text-emerald-200'
                  : 'rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-white/15'
              }
            >
              정보 {showOverlayMeta.value ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>
    );
  };
});
