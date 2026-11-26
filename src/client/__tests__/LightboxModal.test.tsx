// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { ImageItem } from '@/shared/types';
import { LightboxModal } from '../components/LightboxModal';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

const ITEMS: ImageItem[] = [
  {
    id: 'img-0',
    albumId: 'alb-1',
    albumName: '제주 여행',
    caption: '협재 해변',
    tags: ['바다', '가족'],
    takenAt: new Date(2026, 4, 10, 14, 30).getTime(),
    hasExifDate: true,
    uploadedAt: new Date(2026, 4, 10, 15, 0).getTime(),
    width: 2048,
    height: 1536,
    thumbUrl: '/api/media/thumb/img-0',
    displayUrl: '/api/media/display/img-0',
  },
  {
    id: 'img-1',
    albumId: null,
    albumName: null,
    caption: '한라산',
    tags: ['등산'],
    takenAt: new Date(2026, 4, 11, 10, 0).getTime(),
    hasExifDate: false,
    uploadedAt: new Date(2026, 4, 11, 10, 0).getTime(),
    width: 1536,
    height: 2048,
    thumbUrl: '/api/media/thumb/img-1',
    displayUrl: '/api/media/display/img-1',
  },
];

describe('LightboxModal component', () => {
  it('renders high-res display WebP, metadata, preloads adjacent image, handles keyboard/swipe & unlocks body scroll', async () => {
    const preloaded: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        set src(val: string) {
          preloaded.push(val);
        }
      }
    );

    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <LightboxModal
        open={true}
        currentIndex={0}
        total={2}
        item={ITEMS[0]}
        nextItem={ITEMS[1]}
        onClose={onClose}
        onNavigate={onNavigate}
      />
    );

    const img = screen.getByTestId('lightbox-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/media/display/img-0');
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('1 / 2');
    expect(screen.getByTestId('lightbox-caption').textContent).toBe('협재 해변');
    expect(screen.getByTestId('lightbox-meta').textContent).toContain('제주 여행');
    expect(screen.getByTestId('lightbox-meta').textContent).toContain('#바다');

    // Adjacent image preloaded
    expect(preloaded).toContain('/api/media/display/img-1');

    // Body scroll locked while open
    expect(document.body.style.overflow).toBe('hidden');

    // Boundary check at index 0: prev disabled, ArrowLeft ignored
    expect((screen.getByTestId('lightbox-prev') as HTMLButtonElement).disabled).toBe(true);
    await act(() => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(onNavigate).not.toHaveBeenCalled();

    // ArrowRight navigates to next
    await act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(onNavigate).toHaveBeenCalledWith(1);

    // Touch swipe left navigates to next
    const dialog = screen.getByTestId('lightbox-modal');
    await act(() => {
      fireEvent.touchStart(dialog, { touches: [{ clientX: 250, clientY: 100 }] });
      fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 120, clientY: 105 }] });
    });
    expect(onNavigate).toHaveBeenCalledTimes(2);

    // Escape closes modal
    await act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Unmount restores body scroll
    cleanup();
    expect(document.body.style.overflow).toBe('');
    vi.unstubAllGlobals();
  });
});
