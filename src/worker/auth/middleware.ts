import { createMiddleware } from 'hono/factory';
import type { WorkerBindings } from '../env';
import { ApiError } from '../errors';
import { MAX_PENDING_USERS } from '../../shared/constants';
import type { AuthUser, UserApprovalStatus, UserRole } from '../../shared/types';
import {
  buildClearCookie,
  isSecureRequest,
  parseCookies,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from './session';

export interface AppEnv {
  Bindings: WorkerBindings;
  Variables: {
    user: AuthUser;
  };
}

export interface UserAccessRecord {
  role: UserRole;
  status: UserApprovalStatus;
}

export async function resolveUserAccess(
  env: WorkerBindings,
  email: string
): Promise<UserAccessRecord | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const bootstrapAdmin = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (bootstrapAdmin && normalized === bootstrapAdmin) {
    return { role: 'admin', status: 'approved' };
  }

  if (!env.DB) return null;

  const row = await env.DB.prepare('SELECT role, status FROM allowed_users WHERE email = ?')
    .bind(normalized)
    .first<{ role: string; status?: string }>();

  if (!row || (row.role !== 'admin' && row.role !== 'viewer')) {
    return null;
  }

  const status: UserApprovalStatus =
    row.status === 'pending' || row.status === 'rejected' || row.status === 'approved'
      ? row.status
      : 'approved';

  return { role: row.role, status };
}

export async function resolveUserRole(
  env: WorkerBindings,
  email: string
): Promise<UserRole | null> {
  const record = await resolveUserAccess(env, email);
  if (!record || record.status !== 'approved') {
    return null;
  }
  return record.role;
}

export async function createPendingSignup(
  env: WorkerBindings,
  params: { email: string; name: string }
): Promise<'pending' | 'signup_closed'> {
  if (!env.DB) return 'signup_closed';

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM allowed_users WHERE status = 'pending'"
  ).first<{ count: number }>();

  if ((countRow?.count ?? 0) >= MAX_PENDING_USERS) {
    return 'signup_closed';
  }

  const now = Date.now();
  const normalizedEmail = params.email.trim().toLowerCase();
  const safeName = params.name.trim().slice(0, 120);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO allowed_users (email, name, role, status, note, created_at, updated_at)
     VALUES (?, ?, 'viewer', 'pending', '', ?, ?)`
  )
    .bind(normalizedEmail, safeName, now, now)
    .run();

  return 'pending';
}

export async function authenticateRequest(
  env: WorkerBindings,
  cookieHeader: string | undefined
): Promise<AuthUser | null> {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;

  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = await verifySessionToken(token, secret);
  if (!session) return null;

  const currentRole = await resolveUserRole(env, session.email);
  if (!currentRole) return null;

  return {
    email: session.email,
    name: session.name,
    role: currentRole,
  };
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await authenticateRequest(c.env, c.req.header('Cookie'));
  if (!user) {
    const cookies = parseCookies(c.req.header('Cookie'));
    if (cookies[SESSION_COOKIE_NAME]) {
      c.header(
        'Set-Cookie',
        buildClearCookie(SESSION_COOKIE_NAME, isSecureRequest(c.env?.APP_ORIGIN, c.req.url)),
        { append: true }
      );
    }
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  c.set('user', user);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  if (user.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Admin permission required');
  }
  await next();
});
