// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { FrameIdsResponse, FrameItem } from '@/shared/types';
import { PhotoFrameMode } from '../components/PhotoFrameMode';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

function makeFrameItems(count: number): FrameItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `frame-${i}`,
    caption: `액자 사진 ${i}`,
    takenAt: 1_700_000_000_000 + i * 60_000,
    width: 2048,
    height: 1536,
    displayUrl: `/api/media/display/frame-${i}`,
  }));
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PhotoFrameMode component', () => {
  it('loads filtered ids, crossfades between layerA/layerB on timer, pauses/resumes, hides HUD, and cleans up WakeLock on unmount', async () => {
    vi.useFakeTimers();

    const releaseWakeLock = vi.fn().mockResolvedValue(undefined);
    const requestWakeLock = vi.fn().mockResolvedValue({ release: releaseWakeLock });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: requestWakeLock },
    });

    const items = makeFrameItems(3);
    const fetchIds = vi.fn(async (): Promise<FrameIdsResponse> => ({ total: 3, items }));
    const preloadImage = vi.fn(async () => undefined);
    const onClose = vi.fn();

    render(
      <PhotoFrameMode
        filter={{ albumId: 'alb-jeju', tag: '바다', year: 2025 }}
        filterLabel="제주 여행 · 2025년 · #바다"
        onClose={onClose}
        fetchIds={fetchIds}
        preloadImage={preloadImage}
      />
    );

    await flushMicrotasks();

    expect(fetchIds).toHaveBeenCalledWith(
      expect.objectContaining({ albumId: 'alb-jeju', tag: '바다', year: 2025 }),
      expect.any(AbortSignal)
    );
    expect(requestWakeLock).toHaveBeenCalledWith('screen');
    expect(screen.getByTestId('frame-layer-a').getAttribute('data-active')).toBe('true');
    expect(preloadImage).toHaveBeenCalledWith('/api/media/display/frame-0');

    // HUD hides after 3 seconds of idle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('frame-hud').getAttribute('data-visible')).toBe('false');

    // Remaining 2 seconds (total 5s interval) advances to frame-1 on layerB
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(preloadImage).toHaveBeenCalledWith('/api/media/display/frame-1');
    expect(screen.getByTestId('frame-layer-b').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('frame-layer-a').getAttribute('data-active')).toBe('false');

    // Mouse move reveals HUD
    await act(() => {
      fireEvent.mouseMove(screen.getByTestId('photo-frame-mode'));
    });
    expect(screen.getByTestId('frame-hud').getAttribute('data-visible')).toBe('true');

    // Pause prevents next timed advance
    await act(() => {
      fireEvent.click(screen.getByTestId('frame-play-pause'));
    });
    const callsWhenPaused = preloadImage.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(preloadImage).toHaveBeenCalledTimes(callsWhenPaused);

    // Resume and switch interval to 3s -> advances after 3s
    await act(() => {
      fireEvent.click(screen.getByTestId('frame-play-pause'));
      fireEvent.change(screen.getByTestId('frame-interval-select'), { target: { value: '3' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(preloadImage).toHaveBeenCalledWith('/api/media/display/frame-2');
    expect(screen.getByTestId('frame-layer-a').getAttribute('data-active')).toBe('true');

    // Unmount cleans up timers, listeners, WakeLock, and body overflow
    const callsBeforeUnmount = preloadImage.mock.calls.length;
    cleanup();
    expect(releaseWakeLock).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(preloadImage).toHaveBeenCalledTimes(callsBeforeUnmount);
  });

  it('auto-skips failed preloads and pauses with error toast after 3 consecutive failures', async () => {
    vi.useFakeTimers();

    const items = makeFrameItems(4);
    const fetchIds = vi.fn(async (): Promise<FrameIdsResponse> => ({ total: 4, items }));

    // frame-0 succeeds, frame-1 fails -> should skip directly to frame-2!
    let failAll = false;
    const preloadImage = vi.fn(async (url: string) => {
      if (failAll || url.endsWith('frame-1')) {
        throw new Error('network error');
      }
    });

    render(
      <PhotoFrameMode
        filter={{ albumId: null, tag: null }}
        onClose={vi.fn()}
        fetchIds={fetchIds}
        preloadImage={preloadImage}
      />
    );
    await flushMicrotasks();

    // Advance -> tries frame-1 (fails), skips to frame-2 (succeeds)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(preloadImage).toHaveBeenCalledWith('/api/media/display/frame-1');
    expect(preloadImage).toHaveBeenCalledWith('/api/media/display/frame-2');
    expect(screen.getByTestId('frame-layer-b').getAttribute('data-active')).toBe('true');

    // Now simulate 3 consecutive failures -> pauses with toast & retry button
    failAll = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('frame-error-toast')).toBeTruthy();
    expect(screen.getByTestId('frame-error-retry')).toBeTruthy();
    expect(screen.getByTestId('frame-play-pause').textContent).toBe('재생');
  });
});
