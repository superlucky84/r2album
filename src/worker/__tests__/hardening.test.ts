import { describe, expect, it } from 'vitest';
import {
  ALBUM_NAME_MAX_LENGTH,
  BULK_DELETE_MAX,
  CAPTION_MAX_LENGTH,
  DISPLAY_MAX_BYTES,
  TAG_MAX_COUNT,
  TAG_MAX_LENGTH,
} from '../../shared/constants';
import { createApp } from '../index';
import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/session';
import { createTestEnv, createTestWebpBytes, TEST_SESSION_SECRET } from './testHarness';

async function makeAuthHeader(
  email: string,
  role: 'admin' | 'viewer',
  options: { ttlSeconds?: number; secret?: string } = {}
): Promise<Record<string, string>> {
  const token = await signSessionToken(
    { email, name: 'Test User', role },
    options.secret ?? TEST_SESSION_SECRET,
    options.ttlSeconds
  );
  return { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` };
}

function buildUploadForm(options: {
  displayBytes?: Uint8Array;
  thumbBytes?: Uint8Array;
  metadata?: Record<string, unknown>;
}) {
  const form = new FormData();
  const display = options.displayBytes ?? createTestWebpBytes('display-ok');
  const thumb = options.thumbBytes ?? createTestWebpBytes('thumb-ok');
  form.append(
    'display',
    new File([display.buffer as ArrayBuffer], 'display.webp', { type: 'image/webp' })
  );
  form.append(
    'thumb',
    new File([thumb.buffer as ArrayBuffer], 'thumb.webp', { type: 'image/webp' })
  );
  form.append(
    'metadata',
    JSON.stringify({
      originalFilename: 'photo.jpg',
      width: 1200,
      height: 800,
      takenAt: 1_700_000_000_000,
      hasExifDate: true,
      caption: '',
      tags: [],
      ...options.metadata,
    })
  );
  return form;
}

describe('Phase 7 Security Hardening (Auth, RBAC, R2 Path Safety)', () => {
  it('rejects tampered, expired, malformed, and non-approved session cookies across protected routes', async () => {
    const app = createApp();
    const { env, sqlite } = createTestEnv();

    sqlite
      .prepare(
        `INSERT INTO allowed_users (email, name, role, status, note, created_at, updated_at)
         VALUES ('pending@example.com', 'Pending', 'viewer', 'pending', '', 1, 1),
                ('rejected@example.com', 'Rejected', 'viewer', 'rejected', '', 1, 1)`
      )
      .run();

    const validToken = await signSessionToken(
      { email: 'owner@example.com', name: 'Owner', role: 'admin' },
      TEST_SESSION_SECRET
    );
    const tamperedCookie = { Cookie: `${SESSION_COOKIE_NAME}=${validToken}tampered` };
    const wrongSecretCookie = await makeAuthHeader('owner@example.com', 'admin', {
      secret: 'wrong-secret-key-0000000000000000',
    });
    const expiredCookie = await makeAuthHeader('owner@example.com', 'admin', { ttlSeconds: -60 });
    const pendingCookie = await makeAuthHeader('pending@example.com', 'viewer');
    const rejectedCookie = await makeAuthHeader('rejected@example.com', 'viewer');

    const badHeaders = [
      tamperedCookie,
      wrongSecretCookie,
      expiredCookie,
      pendingCookie,
      rejectedCookie,
      { Cookie: `${SESSION_COOKIE_NAME}=not-a-valid-token` },
    ];

    const protectedPaths = [
      '/api/images',
      '/api/filters',
      '/api/images/ids',
      '/api/media/thumb/12345678-abcd',
      '/api/admin/stats',
    ];

    for (const headers of badHeaders) {
      for (const path of protectedPaths) {
        const res = await app.request(path, { headers }, env);
        expect(res.status).toBe(401);
      }
    }
  });

  it('blocks viewer role (403) across every /api/admin/* endpoint', async () => {
    const app = createApp();
    const { env, sqlite } = createTestEnv();

    sqlite
      .prepare(
        `INSERT INTO allowed_users (email, name, role, status, note, created_at, updated_at)
         VALUES ('viewer@example.com', 'Viewer', 'viewer', 'approved', '', 1, 1)`
      )
      .run();

    const viewerHeaders = await makeAuthHeader('viewer@example.com', 'viewer');
    const jsonHeaders = { ...viewerHeaders, 'Content-Type': 'application/json' };

    const adminRequests: Array<[string, RequestInit]> = [
      ['GET', { headers: viewerHeaders }],
      ['POST', { headers: viewerHeaders, body: buildUploadForm({}) }],
      ['PATCH', { headers: jsonHeaders, body: JSON.stringify({ caption: 'hack' }) }],
      ['DELETE', { headers: viewerHeaders }],
      ['POST', { headers: jsonHeaders, body: JSON.stringify({ ids: ['12345678-abcd'] }) }],
      [
        'POST',
        {
          headers: jsonHeaders,
          body: JSON.stringify({ ids: ['12345678-abcd'], addTags: ['hack'] }),
        },
      ],
      ['POST', { headers: jsonHeaders, body: JSON.stringify({ name: 'Hack Album' }) }],
      ['PATCH', { headers: jsonHeaders, body: JSON.stringify({ name: 'Renamed' }) }],
      ['DELETE', { headers: viewerHeaders }],
      ['GET', { headers: viewerHeaders }],
      ['POST', { headers: jsonHeaders, body: JSON.stringify({ email: 'a@b.com', role: 'admin' }) }],
      ['PATCH', { headers: jsonHeaders, body: JSON.stringify({ role: 'admin' }) }],
      ['DELETE', { headers: viewerHeaders }],
    ];

    const adminUrls = [
      '/api/admin/stats',
      '/api/admin/images',
      '/api/admin/images/12345678-abcd',
      '/api/admin/images/12345678-abcd',
      '/api/admin/images/bulk-delete',
      '/api/admin/images/bulk-update',
      '/api/admin/albums',
      '/api/admin/albums/album-1234',
      '/api/admin/albums/album-1234',
      '/api/admin/users',
      '/api/admin/users',
      '/api/admin/users/other%40example.com',
      '/api/admin/users/other%40example.com',
    ];

    for (let i = 0; i < adminUrls.length; i += 1) {
      const [method, init] = adminRequests[i];
      const res = await app.request(adminUrls[i], { ...init, method }, env);
      expect(res.status).toBe(403);
    }
  });

  it('blocks path traversal IDs, invalid media variants, and returns 404 for missing R2 objects', async () => {
    const app = createApp();
    const { env, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin');

    // Plant a sensitive object outside normal thumb/display paths
    r2Store.set('secret.txt', {
      bytes: new TextEncoder().encode('TOP_SECRET'),
      contentType: 'text/plain',
      etag: 'secret',
    });

    const traversalIds = [
      '../secret',
      '..%2F..%2Fsecret',
      'a/b/c',
      'short',
      'bad$id!@#12345',
      '..../secret',
    ];

    for (const rawId of traversalIds) {
      const mediaRes = await app.request(
        `/api/media/display/${rawId}`,
        { headers: adminHeaders },
        env
      );
      expect([400, 404]).toContain(mediaRes.status);
      const text = await mediaRes.text();
      expect(text).not.toContain('TOP_SECRET');

      const delRes = await app.request(
        `/api/admin/images/${rawId}`,
        { method: 'DELETE', headers: adminHeaders },
        env
      );
      expect([400, 404]).toContain(delRes.status);
    }

    // Invalid variant -> 400
    const badVariant = await app.request(
      '/api/media/original/12345678-abcd',
      { headers: adminHeaders },
      env
    );
    expect(badVariant.status).toBe(400);

    // Valid ID format that does not exist in R2 -> 404
    const missingThumb = await app.request(
      '/api/media/thumb/12345678-abcd-ef01',
      { headers: adminHeaders },
      env
    );
    expect(missingThumb.status).toBe(404);
  });
});

describe('Phase 7 Upload & Data Integrity Hardening', () => {
  it('enforces 0-byte, display size limit, caption/tag/album limits, bulk-delete limits, and bootstrap admin immutability', async () => {
    const app = createApp();
    const { env, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin');
    const jsonHeaders = { ...adminHeaders, 'Content-Type': 'application/json' };

    // 1. 0-byte display file -> 400 EMPTY_FILE
    const emptyRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ displayBytes: new Uint8Array(0) }),
      },
      env
    );
    expect(emptyRes.status).toBe(400);
    expect(((await emptyRes.json()) as { error: { code: string } }).error.code).toBe('EMPTY_FILE');

    // 2. Display file > 5MB -> 413 DISPLAY_TOO_LARGE
    const hugeDisplay = new Uint8Array(DISPLAY_MAX_BYTES + 1024);
    hugeDisplay.set(createTestWebpBytes('big'), 0);
    const hugeDisplayRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ displayBytes: hugeDisplay }),
      },
      env
    );
    expect(hugeDisplayRes.status).toBe(413);
    expect(((await hugeDisplayRes.json()) as { error: { code: string } }).error.code).toBe(
      'DISPLAY_TOO_LARGE'
    );

    // 3. Caption > 500 chars -> 400 CAPTION_TOO_LONG
    const longCaptionRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ metadata: { caption: 'a'.repeat(CAPTION_MAX_LENGTH + 1) } }),
      },
      env
    );
    expect(longCaptionRes.status).toBe(400);
    expect(((await longCaptionRes.json()) as { error: { code: string } }).error.code).toBe(
      'CAPTION_TOO_LONG'
    );

    // 4. Tags > 20 -> 400 TOO_MANY_TAGS, and single tag > 30 chars -> 400 TAG_TOO_LONG
    const tooManyTags = Array.from({ length: TAG_MAX_COUNT + 1 }, (_, i) => `tag-${i}`);
    const manyTagsRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ metadata: { tags: tooManyTags } }),
      },
      env
    );
    expect(manyTagsRes.status).toBe(400);
    expect(((await manyTagsRes.json()) as { error: { code: string } }).error.code).toBe(
      'TOO_MANY_TAGS'
    );

    const longTagRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ metadata: { tags: ['x'.repeat(TAG_MAX_LENGTH + 1)] } }),
      },
      env
    );
    expect(longTagRes.status).toBe(400);
    expect(((await longTagRes.json()) as { error: { code: string } }).error.code).toBe(
      'TAG_TOO_LONG'
    );

    // 5. Album name > 60 chars -> 400 ALBUM_NAME_TOO_LONG
    const longAlbumRes = await app.request(
      '/api/admin/albums',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'A'.repeat(ALBUM_NAME_MAX_LENGTH + 1) }),
      },
      env
    );
    expect(longAlbumRes.status).toBe(400);

    // 6. Bulk delete > 50 IDs -> 400 TOO_MANY_IDS, empty array -> 400 INVALID_IDS, traversal ID -> 400
    const tooManyIds = Array.from({ length: BULK_DELETE_MAX + 1 }, (_, i) => `img-valid-${i}`);
    const bulkOverRes = await app.request(
      '/api/admin/images/bulk-delete',
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ids: tooManyIds }) },
      env
    );
    expect(bulkOverRes.status).toBe(400);
    expect(((await bulkOverRes.json()) as { error: { code: string } }).error.code).toBe(
      'TOO_MANY_IDS'
    );

    const bulkEmptyRes = await app.request(
      '/api/admin/images/bulk-delete',
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ids: [] }) },
      env
    );
    expect(bulkEmptyRes.status).toBe(400);

    const bulkBadIdRes = await app.request(
      '/api/admin/images/bulk-delete',
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ids: ['../evil'] }) },
      env
    );
    expect(bulkBadIdRes.status).toBe(400);

    // 7. Bootstrap admin cannot be downgraded via POST or PATCH, nor deleted
    const downgradePost = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ email: 'owner@example.com', role: 'viewer' }),
      },
      env
    );
    expect(downgradePost.status).toBe(400);

    const patchBootstrap = await app.request(
      `/api/admin/users/${encodeURIComponent('owner@example.com')}`,
      {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ role: 'viewer', status: 'rejected' }),
      },
      env
    );
    expect(patchBootstrap.status).toBe(400);

    const delBootstrap = await app.request(
      `/api/admin/users/${encodeURIComponent('owner@example.com')}`,
      { method: 'DELETE', headers: adminHeaders },
      env
    );
    expect(delBootstrap.status).toBe(400);

    // None of the rejected uploads wrote anything into R2
    expect(r2Store.size).toBe(0);
  });

  it('enforces R2 free-tier storage hard cap (507 STORAGE_LIMIT_EXCEEDED) and recovers after deletion', async () => {
    const app = createApp();
    const { env, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin');

    // Configure a tight cap that allows exactly 1 small upload (each upload is ~43 bytes)
    const cappedEnv = { ...env, MAX_STORAGE_BYTES: '60' };

    const firstRes = await app.request(
      '/api/admin/images',
      { method: 'POST', headers: adminHeaders, body: buildUploadForm({}) },
      cappedEnv
    );
    expect(firstRes.status).toBe(201);
    const first = (await firstRes.json()) as { id: string };
    expect(r2Store.size).toBe(2);

    // Second upload exceeds MAX_STORAGE_BYTES -> 507 STORAGE_LIMIT_EXCEEDED, zero extra R2 writes
    const secondRes = await app.request(
      '/api/admin/images',
      { method: 'POST', headers: adminHeaders, body: buildUploadForm({}) },
      cappedEnv
    );
    expect(secondRes.status).toBe(507);
    expect(((await secondRes.json()) as { error: { code: string } }).error.code).toBe(
      'STORAGE_LIMIT_EXCEEDED'
    );
    expect(r2Store.size).toBe(2);

    // Deleting the first image frees space and allows uploading again
    const delRes = await app.request(
      `/api/admin/images/${first.id}`,
      { method: 'DELETE', headers: adminHeaders },
      cappedEnv
    );
    expect(delRes.status).toBe(200);
    expect(r2Store.size).toBe(0);

    const retryRes = await app.request(
      '/api/admin/images',
      { method: 'POST', headers: adminHeaders, body: buildUploadForm({}) },
      cappedEnv
    );
    expect(retryRes.status).toBe(201);
    expect(r2Store.size).toBe(2);
  });
});
