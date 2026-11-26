// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { AlbumSummary, ImageItem, TagSummary } from '@/shared/types';
import { ImageManageTable } from '../components/admin/ImageManageTable';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ALBUMS: AlbumSummary[] = [
  { id: 'alb-1', name: '제주 여행', description: '', imageCount: 2, createdAt: 1, updatedAt: 1 },
];
const TAGS: TagSummary[] = [{ id: 1, name: '바다', imageCount: 1 }];

const SAMPLE_ITEMS: ImageItem[] = [
  {
    id: 'img-11111111',
    albumId: 'alb-1',
    albumName: '제주 여행',
    caption: '협재 해변',
    tags: ['바다'],
    takenAt: new Date(2026, 4, 10, 12, 30).getTime(),
    hasExifDate: true,
    uploadedAt: new Date(2026, 4, 10, 13, 0).getTime(),
    width: 2048,
    height: 1536,
    thumbUrl: '/api/media/thumb/img-11111111',
    displayUrl: '/api/media/display/img-11111111',
  },
  {
    id: 'img-22222222',
    albumId: null,
    albumName: null,
    caption: '서울 카페',
    tags: ['일상'],
    takenAt: new Date(2026, 4, 9, 10, 0).getTime(),
    hasExifDate: false,
    uploadedAt: new Date(2026, 4, 9, 10, 0).getTime(),
    width: 1600,
    height: 1200,
    thumbUrl: '/api/media/thumb/img-22222222',
    displayUrl: '/api/media/display/img-22222222',
  },
];

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('ImageManageTable component', () => {
  it('supports inline metadata editing and single delete with confirmation modal', async () => {
    let store = [...SAMPLE_ITEMS];
    const onDataChanged = vi.fn();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.startsWith('/api/images') && method === 'GET') {
        return new Response(
          JSON.stringify({ total: store.length, offset: 0, limit: 40, items: store }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/admin/images/img-11111111' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { caption: string; tags: string[] };
        store = store.map((item) =>
          item.id === 'img-11111111' ? { ...item, caption: body.caption, tags: body.tags } : item
        );
        return new Response(JSON.stringify(store[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/admin/images/img-22222222' && method === 'DELETE') {
        store = store.filter((item) => item.id !== 'img-22222222');
        return new Response(JSON.stringify({ ok: true, deletedId: 'img-22222222' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    });

    render(<ImageManageTable albums={ALBUMS} tags={TAGS} onDataChanged={onDataChanged} />);
    await flush();

    expect(screen.getByTestId('image-row-img-11111111')).toBeTruthy();
    expect(screen.getByTestId('image-row-img-22222222')).toBeTruthy();

    // Inline edit row 1
    await act(() => {
      fireEvent.click(screen.getByTestId('edit-image-img-11111111'));
    });
    await act(() => {
      fireEvent.input(screen.getByTestId('edit-caption-img-11111111'), {
        target: { value: '수정된 협재 해변' },
      });
      fireEvent.input(screen.getByTestId('edit-tags-img-11111111'), {
        target: { value: '바다, 석양' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-edit-img-11111111'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('image-row-img-11111111').textContent).toContain('수정된 협재 해변');
    expect(screen.getByTestId('image-row-img-11111111').textContent).toContain('#석양');
    expect(onDataChanged).toHaveBeenCalledTimes(1);

    // Single delete opens confirmation modal before calling DELETE
    await act(() => {
      fireEvent.click(screen.getByTestId('delete-image-img-22222222'));
    });
    expect(screen.getByTestId('confirm-modal')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/images/img-22222222', expect.anything());

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByTestId('image-row-img-22222222')).toBeNull();
    expect(onDataChanged).toHaveBeenCalledTimes(2);
  });

  it('supports multi-select bulk delete via confirmation modal', async () => {
    let store = [...SAMPLE_ITEMS];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.startsWith('/api/images') && method === 'GET') {
        return new Response(
          JSON.stringify({ total: store.length, offset: 0, limit: 40, items: store }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/admin/images/bulk-delete' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { ids: string[] };
        store = store.filter((item) => !body.ids.includes(item.id));
        return new Response(JSON.stringify({ ok: true, deletedIds: body.ids }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    });

    render(<ImageManageTable albums={ALBUMS} tags={TAGS} />);
    await flush();

    await act(() => {
      fireEvent.click(screen.getByTestId('manage-select-all'));
    });
    await act(() => {
      fireEvent.click(screen.getByTestId('bulk-delete-button'));
    });
    expect(screen.getByTestId('confirm-modal')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/images/bulk-delete',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.queryByTestId('image-row-img-11111111')).toBeNull();
    expect(screen.queryByTestId('image-row-img-22222222')).toBeNull();
  });
});
