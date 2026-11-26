// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { fireEvent, screen } from '@testing-library/dom';
import type { AllowedUserRecord } from '@/shared/types';
import { UserAllowlistManager } from '../components/admin/UserAllowlistManager';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('UserAllowlistManager component', () => {
  it('approves pending signup, pre-registers user, protects bootstrap admin, and deletes via modal', async () => {
    let users: AllowedUserRecord[] = [
      {
        email: 'mom@example.com',
        name: '엄마',
        role: 'viewer',
        status: 'pending',
        note: '',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        isBootstrapAdmin: false,
      },
      {
        email: 'owner@example.com',
        name: 'Owner',
        role: 'admin',
        status: 'approved',
        note: 'Bootstrap',
        createdAt: 0,
        updatedAt: 0,
        isBootstrapAdmin: true,
      },
    ];

    const onUsersChanged = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/admin/users' && method === 'GET') {
        return new Response(
          JSON.stringify({
            pendingCount: users.filter((u) => u.status === 'pending').length,
            users,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/admin/users' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          email: string;
          name: string;
          role: 'admin' | 'viewer';
          note: string;
        };
        const created: AllowedUserRecord = {
          email: body.email,
          name: body.name,
          role: body.role,
          status: 'approved',
          note: body.note,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isBootstrapAdmin: false,
        };
        users = [...users, created];
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url === `/api/admin/users/${encodeURIComponent('mom@example.com')}` &&
        method === 'PATCH'
      ) {
        const body = JSON.parse(String(init?.body)) as Partial<AllowedUserRecord>;
        users = users.map((u) => (u.email === 'mom@example.com' ? { ...u, ...body } : u));
        const updated = users.find((u) => u.email === 'mom@example.com')!;
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url === `/api/admin/users/${encodeURIComponent('dad@example.com')}` &&
        method === 'DELETE'
      ) {
        users = users.filter((u) => u.email !== 'dad@example.com');
        return new Response(JSON.stringify({ ok: true, deletedEmail: 'dad@example.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    });

    render(<UserAllowlistManager onUsersChanged={onUsersChanged} />);
    await flush();

    // Pending user visible in queue
    expect(screen.getByTestId('pending-users-count').textContent).toBe('1명');
    expect(screen.getByTestId('pending-user-mom@example.com')).toBeTruthy();

    // Bootstrap admin controls are disabled
    expect((screen.getByTestId('user-role-owner@example.com') as HTMLSelectElement).disabled).toBe(
      true
    );
    expect(
      (screen.getByTestId('delete-user-owner@example.com') as HTMLButtonElement).disabled
    ).toBe(true);

    // Approve pending user as viewer
    await act(async () => {
      fireEvent.click(screen.getByTestId('approve-viewer-mom@example.com'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('pending-users-count').textContent).toBe('0명');
    expect(screen.getByTestId('user-row-mom@example.com')).toBeTruthy();

    // Pre-register a new user directly
    await act(() => {
      fireEvent.input(screen.getByTestId('add-user-email'), {
        target: { value: 'dad@example.com' },
      });
      fireEvent.input(screen.getByTestId('add-user-name'), {
        target: { value: '아빠' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-user-submit'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('user-row-dad@example.com')).toBeTruthy();

    // Delete via confirm modal
    await act(() => {
      fireEvent.click(screen.getByTestId('delete-user-dad@example.com'));
    });
    expect(screen.getByTestId('confirm-modal')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByTestId('user-row-dad@example.com')).toBeNull();
    expect(onUsersChanged).toHaveBeenCalledTimes(3);
  });
});
