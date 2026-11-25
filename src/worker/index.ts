import { Hono } from 'hono';
import type { WorkerBindings } from './env';
import { ApiError } from './errors';
import type { ApiErrorBody, HealthResponse } from '../shared/types';

export function createApp() {
  const app = new Hono<{ Bindings: WorkerBindings }>();

  app.get('/api/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      service: 'r2album',
      timestamp: Date.now(),
    };
    return c.json(body);
  });

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
      return c.env.ASSETS.fetch(c.req.raw);
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
