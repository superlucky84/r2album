// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import { App } from '../App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App auth guard & RBAC routing', () => {
  it('renders LoginView with pending status message when unauthenticated', async () => {
    window.history.replaceState(null, '', '/login?status=pending');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<App />);
    await flushPromises();

    expect(screen.getByTestId('google-login-button')).toBeTruthy();
    expect(screen.getByTestId('login-notice').textContent).toContain('관리자 승인 대기 중');
  });

  it('redirects viewer away from /admin and hides admin nav link', async () => {
    window.history.replaceState(null, '', '/admin');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/me') {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { email: 'family@example.com', name: 'Family', role: 'viewer' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('/api/filters')) {
        return new Response(JSON.stringify({ albums: [], tags: [], totalImages: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/api/images')) {
        return new Response(JSON.stringify({ total: 0, offset: 0, limit: 40, items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    render(<App />);
    await flushPromises();

    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('gallery-view')).toBeTruthy();
    expect(screen.queryByTestId('nav-admin-link')).toBeNull();
  });

  it('allows admin to navigate to /admin and log out', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/me') {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { email: 'owner@example.com', name: 'Owner', role: 'admin' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/auth/logout') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/admin/stats') {
        return new Response(
          JSON.stringify({
            totalImages: 0,
            totalDisplayBytes: 0,
            totalThumbBytes: 0,
            totalBytes: 0,
            freeTierBytes: 10 * 1024 * 1024 * 1024,
            usageRatio: 0,
            pendingUsers: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('/api/filters')) {
        return new Response(JSON.stringify({ albums: [], tags: [], totalImages: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/api/images')) {
        return new Response(JSON.stringify({ total: 0, offset: 0, limit: 40, items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    render(<App />);
    await flushPromises();

    const adminLink = screen.getByTestId('nav-admin-link');
    await act(() => {
      fireEvent.click(adminLink);
    });
    expect(window.location.pathname).toBe('/admin');
    expect(screen.getByTestId('admin-view')).toBeTruthy();

    const logoutBtn = screen.getByTestId('logout-button');
    await act(async () => {
      fireEvent.click(logoutBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.getByTestId('google-login-button')).toBeTruthy();
  });
});
