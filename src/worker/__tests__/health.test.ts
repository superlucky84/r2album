import { describe, expect, it } from 'vitest';
import { createApp } from '../index';
import type { ApiErrorBody, HealthResponse } from '../../shared/types';

describe('Worker baseline routes', () => {
  it('returns 200 OK on GET /api/health', async () => {
    const app = createApp();
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('r2album');
    expect(typeof body.timestamp).toBe('number');
  });

  it('returns unified JSON error body for unknown /api/* routes', async () => {
    const app = createApp();
    const res = await app.request('/api/does-not-exist');

    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/api/does-not-exist');
  });
});
