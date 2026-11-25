import { describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createApp } from '../index';
import type { WorkerBindings } from '../env';
import { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME, signSessionToken } from '../auth/session';
import type { MeResponse, UserApprovalStatus, UserRole } from '../../shared/types';

const TEST_SECRET = 'phase-2-test-session-secret-key-32-bytes';

interface MockUserRow {
  email: string;
  name: string;
  role: UserRole;
  status: UserApprovalStatus;
}

function createMockDb(
  initialUsers: Record<string, MockUserRow> = {},
  pendingCountOverride?: number
) {
  const users = new Map<string, MockUserRow>(Object.entries(initialUsers));

  const db = {
    prepare(query: string) {
      const exec = (args: unknown[]) => ({
        async first<T = unknown>() {
          if (query.includes('FROM allowed_users WHERE email = ?')) {
            const email = String(args[0] ?? '').toLowerCase();
            const row = users.get(email);
            return (row ? { role: row.role, status: row.status } : null) as T | null;
          }
          if (query.includes("COUNT(*) AS count FROM allowed_users WHERE status = 'pending'")) {
            if (typeof pendingCountOverride === 'number') {
              return { count: pendingCountOverride } as T;
            }
            let count = 0;
            for (const row of users.values()) {
              if (row.status === 'pending') count += 1;
            }
            return { count } as T;
          }
          return null;
        },
        async run() {
          if (query.includes('INSERT OR IGNORE INTO allowed_users')) {
            const email = String(args[0] ?? '').toLowerCase();
            const name = String(args[1] ?? '');
            if (!users.has(email)) {
              users.set(email, { email, name, role: 'viewer', status: 'pending' });
            }
          }
          return { success: true };
        },
      });

      return {
        ...exec([]),
        bind(...args: unknown[]) {
          return exec(args);
        },
      };
    },
  };

  return { db: db as unknown as D1Database, users };
}

function createEnv(initialUsers: Record<string, MockUserRow> = {}, pendingCountOverride?: number) {
  const { db, users } = createMockDb(initialUsers, pendingCountOverride);
  const env: WorkerBindings = {
    DB: db,
    MEDIA_BUCKET: {} as R2Bucket,
    APP_ORIGIN: 'http://localhost:5173',
    BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    SESSION_SECRET: TEST_SECRET,
  };
  return { env, users };
}

function createGoogleMockFetch(userInfo: {
  email: string;
  email_verified: boolean;
  name: string;
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('openidconnect.googleapis.com/v1/userinfo')) {
      return new Response(JSON.stringify(userInfo), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function getSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get('Set-Cookie');
  return single ? [single] : [];
}

function extractCookieValue(headers: Headers, name: string): string | null {
  for (const header of getSetCookies(headers)) {
    const match = header.match(new RegExp(`^${name}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

async function runOAuthFlow(app: ReturnType<typeof createApp>, env: WorkerBindings) {
  const startRes = await app.request('/auth/google', {}, env);
  const state = new URL(startRes.headers.get('Location')!).searchParams.get('state')!;
  const stateCookie = extractCookieValue(startRes.headers, OAUTH_STATE_COOKIE_NAME)!;

  return app.request(
    `/auth/google/callback?code=valid-code&state=${encodeURIComponent(state)}`,
    {
      headers: { Cookie: `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(stateCookie)}` },
    },
    env
  );
}

describe('Worker Google OAuth, RBAC & signup approval flow', () => {
  it('starts Google OAuth flow with PKCE challenge and HttpOnly state cookie', async () => {
    const app = createApp();
    const { env } = createEnv();

    const res = await app.request('/auth/google', {}, env);
    expect(res.status).toBe(302);

    const authUrl = new URL(res.headers.get('Location')!);
    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.searchParams.get('client_id')).toBe('google-client-id');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/auth/google/callback'
    );
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(extractCookieValue(res.headers, OAUTH_STATE_COOKIE_NAME)).toBeTruthy();
  });

  it('rejects callback with mismatched state', async () => {
    const app = createApp();
    const { env } = createEnv();

    const startRes = await app.request('/auth/google', {}, env);
    const stateCookie = extractCookieValue(startRes.headers, OAUTH_STATE_COOKIE_NAME)!;

    const callbackRes = await app.request(
      '/auth/google/callback?code=abc&state=wrong-state',
      { headers: { Cookie: `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(stateCookie)}` } },
      env
    );

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe(
      'http://localhost:5173/login?error=invalid_state'
    );
  });

  it('rejects callback when Google email_verified is false', async () => {
    const app = createApp({
      fetchImpl: createGoogleMockFetch({
        email: 'owner@example.com',
        email_verified: false,
        name: 'Owner',
      }),
    });
    const { env } = createEnv();

    const callbackRes = await runOAuthFlow(app, env);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe(
      'http://localhost:5173/login?error=unverified_email'
    );
    expect(extractCookieValue(callbackRes.headers, SESSION_COOKIE_NAME)).toBeNull();
  });

  it('registers unregistered Google account as pending without issuing a session cookie', async () => {
    const app = createApp({
      fetchImpl: createGoogleMockFetch({
        email: 'sister@example.com',
        email_verified: true,
        name: 'Sister',
      }),
    });
    const { env, users } = createEnv();

    const callbackRes = await runOAuthFlow(app, env);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe('http://localhost:5173/login?status=pending');

    const sessionHeader = getSetCookies(callbackRes.headers).find((h) =>
      h.startsWith(`${SESSION_COOKIE_NAME}=`)
    );
    expect(sessionHeader).toContain('Max-Age=0');

    expect(users.get('sister@example.com')).toEqual({
      email: 'sister@example.com',
      name: 'Sister',
      role: 'viewer',
      status: 'pending',
    });
  });

  it('redirects rejected account to /login?error=rejected without issuing session', async () => {
    const app = createApp({
      fetchImpl: createGoogleMockFetch({
        email: 'blocked@example.com',
        email_verified: true,
        name: 'Blocked',
      }),
    });
    const { env } = createEnv({
      'blocked@example.com': {
        email: 'blocked@example.com',
        name: 'Blocked',
        role: 'viewer',
        status: 'rejected',
      },
    });

    const callbackRes = await runOAuthFlow(app, env);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe('http://localhost:5173/login?error=rejected');
  });

  it('redirects to signup_closed when pending queue reaches MAX_PENDING_USERS', async () => {
    const app = createApp({
      fetchImpl: createGoogleMockFetch({
        email: 'newbie@example.com',
        email_verified: true,
        name: 'Newbie',
      }),
    });
    const { env, users } = createEnv({}, 100);

    const callbackRes = await runOAuthFlow(app, env);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe(
      'http://localhost:5173/login?error=signup_closed'
    );
    expect(users.has('newbie@example.com')).toBe(false);
  });

  it('issues session cookie for bootstrap admin and returns user on /api/me', async () => {
    const app = createApp({
      fetchImpl: createGoogleMockFetch({
        email: 'OWNER@example.com',
        email_verified: true,
        name: 'Owner',
      }),
    });
    const { env } = createEnv();

    const callbackRes = await runOAuthFlow(app, env);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe('http://localhost:5173/');

    const sessionToken = extractCookieValue(callbackRes.headers, SESSION_COOKIE_NAME)!;
    const meRes = await app.request(
      '/api/me',
      { headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}` } },
      env
    );
    expect((await meRes.json()) as MeResponse).toEqual({
      authenticated: true,
      user: { email: 'owner@example.com', name: 'Owner', role: 'admin' },
    });
  });

  it('enforces 401 for unauthenticated/pending users and 403 for approved viewer on /api/admin/*', async () => {
    const app = createApp();
    app.get('/api/images/ping', (c) => c.json({ ok: true, role: c.get('user').role }));
    app.get('/api/admin/ping', (c) => c.json({ ok: true, role: c.get('user').role }));

    const { env } = createEnv({
      'family@example.com': {
        email: 'family@example.com',
        name: 'Family',
        role: 'viewer',
        status: 'approved',
      },
      'waiting@example.com': {
        email: 'waiting@example.com',
        name: 'Waiting',
        role: 'viewer',
        status: 'pending',
      },
    });

    // Unauthenticated -> 401
    expect((await app.request('/api/images/ping', {}, env)).status).toBe(401);
    expect((await app.request('/api/admin/ping', {}, env)).status).toBe(401);

    // Pending user cannot access API even with signed token -> 401
    const pendingToken = await signSessionToken(
      { email: 'waiting@example.com', name: 'Waiting', role: 'viewer' },
      TEST_SECRET
    );
    expect(
      (
        await app.request(
          '/api/images/ping',
          { headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(pendingToken)}` } },
          env
        )
      ).status
    ).toBe(401);

    // Approved viewer -> 200 on /api/images/*, 403 on /api/admin/*
    const viewerToken = await signSessionToken(
      { email: 'family@example.com', name: 'Family', role: 'viewer' },
      TEST_SECRET
    );
    const viewerHeaders = { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(viewerToken)}` };
    expect((await app.request('/api/images/ping', { headers: viewerHeaders }, env)).status).toBe(
      200
    );
    expect((await app.request('/api/admin/ping', { headers: viewerHeaders }, env)).status).toBe(
      403
    );

    // Bootstrap admin -> 200 on both
    const adminToken = await signSessionToken(
      { email: 'owner@example.com', name: 'Owner', role: 'admin' },
      TEST_SECRET
    );
    const adminHeaders = { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(adminToken)}` };
    expect((await app.request('/api/images/ping', { headers: adminHeaders }, env)).status).toBe(
      200
    );
    expect((await app.request('/api/admin/ping', { headers: adminHeaders }, env)).status).toBe(200);
  });

  it('immediately revokes access if a viewer is removed or rejected', async () => {
    const app = createApp();
    app.get('/api/images/ping', (c) => c.json({ ok: true }));

    const { env, users } = createEnv({
      'guest@example.com': {
        email: 'guest@example.com',
        name: 'Guest',
        role: 'viewer',
        status: 'approved',
      },
    });

    const guestToken = await signSessionToken(
      { email: 'guest@example.com', name: 'Guest', role: 'viewer' },
      TEST_SECRET
    );
    const headers = { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(guestToken)}` };

    expect((await app.request('/api/images/ping', { headers }, env)).status).toBe(200);

    users.set('guest@example.com', {
      email: 'guest@example.com',
      name: 'Guest',
      role: 'viewer',
      status: 'rejected',
    });
    expect((await app.request('/api/images/ping', { headers }, env)).status).toBe(401);

    const meRes = await app.request('/api/me', { headers }, env);
    expect((await meRes.json()) as MeResponse).toEqual({ authenticated: false });
  });

  it('clears session cookie on POST /auth/logout', async () => {
    const app = createApp();
    const { env } = createEnv();

    const res = await app.request('/auth/logout', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const cookieHeader = getSetCookies(res.headers).join('; ');
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieHeader).toContain('Max-Age=0');
  });
});
