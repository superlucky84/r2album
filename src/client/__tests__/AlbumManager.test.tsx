// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { AlbumSummary } from '@/shared/types';
import { AlbumManager } from '../components/admin/AlbumManager';
import { AdminView } from '../components/admin/AdminView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('AlbumManager & AdminView', () => {
  it('creates, edits, and deletes albums with confirmation modal', async () => {
    const onAlbumsChanged = vi.fn();
    const initialAlbums: AlbumSummary[] = [
      {
        id: 'alb-1',
        name: '부산',
        description: '겨울 여행',
        imageCount: 4,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/admin/albums' && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'alb-2',
            name: '제주',
            description: '가족 여행',
            imageCount: 0,
            createdAt: 2,
            updatedAt: 2,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/admin/albums/alb-1' && method === 'PATCH') {
        return new Response(
          JSON.stringify({ ...initialAlbums[0], name: '부산 2026', description: '겨울 여행' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/admin/albums/alb-1' && method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true, deletedId: 'alb-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    });

    render(<AlbumManager albums={initialAlbums} onAlbumsChanged={onAlbumsChanged} />);

    // Create album
    await act(() => {
      fireEvent.input(screen.getByTestId('album-name-input'), { target: { value: '제주' } });
      fireEvent.input(screen.getByTestId('album-desc-input'), { target: { value: '가족 여행' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('album-create-submit'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/albums',
      expect.objectContaining({ method: 'POST' })
    );

    // Edit album
    await act(() => {
      fireEvent.click(screen.getByTestId('album-edit-alb-1'));
    });
    await act(() => {
      fireEvent.input(screen.getByTestId('album-edit-name-alb-1'), {
        target: { value: '부산 2026' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('album-save-alb-1'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/albums/alb-1',
      expect.objectContaining({ method: 'PATCH' })
    );

    // Delete album via confirmation modal
    await act(() => {
      fireEvent.click(screen.getByTestId('album-delete-alb-1'));
    });
    expect(screen.getByTestId('confirm-modal')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/albums/alb-1',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(onAlbumsChanged).toHaveBeenCalledTimes(3);
  });

  it('renders StorageGauge and pending badge inside AdminView', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/admin/stats') {
        return new Response(
          JSON.stringify({
            totalImages: 120,
            totalDisplayBytes: 1_500_000_000,
            totalThumbBytes: 100_000_000,
            totalBytes: 1_600_000_000,
            freeTierBytes: 10 * 1024 * 1024 * 1024,
            usageRatio: 1_600_000_000 / (10 * 1024 * 1024 * 1024),
            pendingUsers: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('/api/filters')) {
        return new Response(JSON.stringify({ albums: [], tags: [], totalImages: 120 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    render(<AdminView />);
    await flush();

    expect(screen.getByTestId('storage-usage-text').textContent).toContain('1.49 GB / 10.00 GB');
    expect(screen.getByTestId('stats-total-images').textContent).toContain('120장');
    expect(screen.getByTestId('admin-tab-pending-badge').textContent).toBe('2');
  });
});
