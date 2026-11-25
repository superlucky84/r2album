import { Hono } from 'hono';
import { ApiError } from './errors';
import type { ApiErrorBody, HealthResponse } from '../shared/types';
import { requireAdmin, requireAuth, type AppEnv } from './auth/middleware';
import { createAuthRoutes, type AuthRoutesOptions } from './routes/auth';
import { createMediaRoutes } from './routes/media';
import { createImageRoutes } from './routes/images';
import { createAdminRoutes } from './routes/admin';

export type CreateAppOptions = AuthRoutesOptions;

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.get('/api/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      service: 'r2album',
      timestamp: Date.now(),
    };
    return c.json(body);
  });

  // Public auth endpoints (/auth/*, /api/me)
  app.route('/', createAuthRoutes(options));

  // Role-based access guards for protected API prefixes
  app.use('/api/images/*', requireAuth);
  app.use('/api/images', requireAuth);
  app.use('/api/filters', requireAuth);
  app.use('/api/media/*', requireAuth);

  app.use('/api/admin/*', requireAuth, requireAdmin);
  app.use('/api/admin', requireAuth, requireAdmin);

  // Authenticated & Admin domain routes
  app.route('/', createMediaRoutes());
  app.route('/', createImageRoutes());
  app.route('/', createAdminRoutes());

  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const body: ApiErrorBody = {
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${path}`,
        },
      };
      return c.json(body, 404);
    }

    if (c.env?.ASSETS) {
      return c.env.ASSETS.fetch(
        c.req.raw as unknown as Parameters<typeof c.env.ASSETS.fetch>[0]
      ) as unknown as Promise<Response>;
    }

    const body: ApiErrorBody = {
      error: {
        code: 'NOT_FOUND',
        message: `Resource not found: ${path}`,
      },
    };
    return c.json(body, 404);
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      const body: ApiErrorBody = {
        error: {
          code: err.code,
          message: err.message,
        },
      };
      return c.json(body, err.status);
    }

    console.error('[r2album] unhandled worker error:', err);
    const body: ApiErrorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    };
    return c.json(body, 500);
  });

  return app;
}

const app = createApp();

export default app;
