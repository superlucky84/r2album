import { describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/session';
import type {
  AdminStatsResponse,
  AdminUsersResponse,
  AlbumSummary,
  AllowedUserRecord,
  FiltersResponse,
  FrameIdsResponse,
  ImageItem,
  ImagesRangeResponse,
} from '../../shared/types';
import { createTestEnv, createTestWebpBytes, TEST_SESSION_SECRET } from './testHarness';

async function makeAuthHeader(
  email: string,
  role: 'admin' | 'viewer',
  name = 'Test User'
): Promise<Record<string, string>> {
  const token = await signSessionToken({ email, name, role }, TEST_SESSION_SECRET);
  return { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` };
}

function buildUploadForm(options: {
  displayBytes?: Uint8Array;
  thumbBytes?: Uint8Array;
  metadata?: Record<string, unknown>;
}) {
  const form = new FormData();
  const display = options.displayBytes ?? createTestWebpBytes('display-content');
  const thumb = options.thumbBytes ?? createTestWebpBytes('thumb-content');
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
      originalFilename: 'IMG_0001.JPG',
      width: 2048,
      height: 1536,
      takenAt: 1_700_000_000_000,
      hasExifDate: true,
      caption: 'Sample photo',
      tags: ['Travel', 'Family'],
      ...options.metadata,
    })
  );
  return form;
}

describe('Phase 3 API: media streaming, images range/filter & admin CRUD', () => {
  it('uploads WebP images, serves private R2 media with immutable cache & ETag 304, and blocks unauthenticated access', async () => {
    const app = createApp();
    const { env, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');

    const uploadRes = await app.request(
      '/api/admin/images',
      { method: 'POST', headers: adminHeaders, body: buildUploadForm({}) },
      env
    );
    expect(uploadRes.status).toBe(201);
    const created = (await uploadRes.json()) as ImageItem;
    expect(created.id).toBeTruthy();
    expect(created.tags).toEqual(['family', 'travel']);
    expect(r2Store.size).toBe(2);

    // Unauthenticated media request -> 401
    const unauthMedia = await app.request(created.thumbUrl, {}, env);
    expect(unauthMedia.status).toBe(401);

    // Authenticated media request -> 200 + private immutable cache headers
    const authMedia = await app.request(created.thumbUrl, { headers: adminHeaders }, env);
    expect(authMedia.status).toBe(200);
    expect(authMedia.headers.get('Content-Type')).toBe('image/webp');
    expect(authMedia.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    const etag = authMedia.headers.get('ETag');
    expect(etag).toBeTruthy();

    // Conditional request with matching ETag -> 304
    const notModified = await app.request(
      created.thumbUrl,
      { headers: { ...adminHeaders, 'If-None-Match': etag! } },
      env
    );
    expect(notModified.status).toBe(304);
  });

  it('rejects spoofed non-WebP files and oversized thumbnails, and rolls back R2 if D1 insert fails', async () => {
    const app = createApp();
    const { env, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');

    // Spoofed PNG bytes claiming to be webp -> 400 INVALID_WEBP
    const fakeBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
    const badRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ displayBytes: fakeBytes }),
      },
      env
    );
    expect(badRes.status).toBe(400);
    expect(r2Store.size).toBe(0);

    // Oversized thumbnail (> 512KB) -> 413
    const hugeThumb = new Uint8Array(600 * 1024);
    hugeThumb.set(createTestWebpBytes('x'), 0);
    const largeRes = await app.request(
      '/api/admin/images',
      {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm({ thumbBytes: hugeThumb }),
      },
      env
    );
    expect(largeRes.status).toBe(413);
    expect(r2Store.size).toBe(0);

    // D1 failure rolls back R2 objects cleanly
    const failing = createTestEnv({ failOnInsertImages: true });
    const failRes = await app.request(
      '/api/admin/images',
      { method: 'POST', headers: adminHeaders, body: buildUploadForm({}) },
      failing.env
    );
    expect(failRes.status).toBe(500);
    expect(failing.r2Store.size).toBe(0);
  });

  it('sorts by EXIF takenAt DESC, supports album/tag filters, range pagination, frame IDs, and deletion', async () => {
    const app = createApp();
    const { env, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');

    // Create album
    const albumRes = await app.request(
      '/api/admin/albums',
      {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Jeju Trip', description: 'Summer 2026' }),
      },
      env
    );
    expect(albumRes.status).toBe(201);
    const album = (await albumRes.json()) as AlbumSummary;

    // Upload 3 images with distinct EXIF takenAt timestamps
    const uploads = [
      { takenAt: 1_700_000_001_000, caption: 'Oldest', albumId: album.id, tags: ['beach', 'jeju'] },
      { takenAt: 1_700_000_003_000, caption: 'Newest', albumId: album.id, tags: ['jeju'] },
      { takenAt: 1_700_000_002_000, caption: 'Middle', albumId: null, tags: ['beach'] },
    ];

    const createdItems: ImageItem[] = [];
    for (const meta of uploads) {
      const res = await app.request(
        '/api/admin/images',
        { method: 'POST', headers: adminHeaders, body: buildUploadForm({ metadata: meta }) },
        env
      );
      expect(res.status).toBe(201);
      createdItems.push((await res.json()) as ImageItem);
    }

    // Range fetch with offset/limit ordered by takenAt DESC
    const page1Res = await app.request(
      '/api/images?offset=0&limit=2',
      { headers: adminHeaders },
      env
    );
    const page1 = (await page1Res.json()) as ImagesRangeResponse;
    expect(page1.total).toBe(3);
    expect(page1.items.map((i) => i.caption)).toEqual(['Newest', 'Middle']);

    const page2Res = await app.request(
      '/api/images?offset=2&limit=2',
      { headers: adminHeaders },
      env
    );
    const page2 = (await page2Res.json()) as ImagesRangeResponse;
    expect(page2.items.map((i) => i.caption)).toEqual(['Oldest']);

    // Combined album + tag filter
    const filteredRes = await app.request(
      `/api/images?albumId=${encodeURIComponent(album.id)}&tag=beach`,
      { headers: adminHeaders },
      env
    );
    const filtered = (await filteredRes.json()) as ImagesRangeResponse;
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].caption).toBe('Oldest');

    // Frame IDs endpoint respects filters
    const frameRes = await app.request(
      `/api/images/ids?albumId=${encodeURIComponent(album.id)}`,
      { headers: adminHeaders },
      env
    );
    const frame = (await frameRes.json()) as FrameIdsResponse;
    expect(frame.total).toBe(2);
    expect(frame.items.map((f) => f.caption)).toEqual(['Newest', 'Oldest']);

    // Filters summary counts
    const filtersRes = await app.request('/api/filters', { headers: adminHeaders }, env);
    const filters = (await filtersRes.json()) as FiltersResponse;
    expect(filters.totalImages).toBe(3);
    expect(filters.albums[0]).toMatchObject({ name: 'Jeju Trip', imageCount: 2 });
    expect(filters.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'beach', imageCount: 2 }),
        expect.objectContaining({ name: 'jeju', imageCount: 2 }),
      ])
    );

    // Update image metadata
    const targetId = createdItems[2].id;
    const patchRes = await app.request(
      `/api/admin/images/${targetId}`,
      {
        method: 'PATCH',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: 'Updated Middle', albumId: album.id, tags: ['sunset'] }),
      },
      env
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as ImageItem;
    expect(patched.caption).toBe('Updated Middle');
    expect(patched.albumId).toBe(album.id);
    expect(patched.tags).toEqual(['sunset']);

    // Delete single image removes D1 record + both R2 keys
    expect(r2Store.size).toBe(6);
    const delRes = await app.request(
      `/api/admin/images/${targetId}`,
      { method: 'DELETE', headers: adminHeaders },
      env
    );
    expect(delRes.status).toBe(200);
    expect(r2Store.size).toBe(4);
    expect(
      (await app.request(`/api/media/display/${targetId}`, { headers: adminHeaders }, env)).status
    ).toBe(404);

    // Bulk delete remaining 2 images
    const bulkRes = await app.request(
      '/api/admin/images/bulk-delete',
      {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [createdItems[0].id, createdItems[1].id] }),
      },
      env
    );
    expect(bulkRes.status).toBe(200);
    expect(r2Store.size).toBe(0);
  });

  it('manages pending user approvals, direct pre-registration, stats, and bootstrap admin protection', async () => {
    const app = createApp();
    const { env, sqlite } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');

    // Seed a pending signup row as if created by Google OAuth callback
    sqlite
      .prepare(
        `INSERT INTO allowed_users (email, name, role, status, note, created_at, updated_at)
         VALUES (?, ?, 'viewer', 'pending', '', ?, ?)`
      )
      .run('mom@example.com', 'Mom', 1_700_000_000_000, 1_700_000_000_000);

    // Admin stats reflect pendingUsers = 1
    const statsRes = await app.request('/api/admin/stats', { headers: adminHeaders }, env);
    const stats = (await statsRes.json()) as AdminStatsResponse;
    expect(stats.pendingUsers).toBe(1);

    // Admin users list surfaces pending first
    const listRes = await app.request('/api/admin/users', { headers: adminHeaders }, env);
    const list = (await listRes.json()) as AdminUsersResponse;
    expect(list.pendingCount).toBe(1);
    expect(list.users[0]).toMatchObject({ email: 'mom@example.com', status: 'pending' });

    // Approve pending user as viewer
    const approveRes = await app.request(
      `/api/admin/users/${encodeURIComponent('mom@example.com')}`,
      {
        method: 'PATCH',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', role: 'viewer' }),
      },
      env
    );
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as AllowedUserRecord;
    expect(approved.status).toBe('approved');
    expect(approved.role).toBe('viewer');

    // Approved viewer can now call /api/filters
    const momHeaders = await makeAuthHeader('mom@example.com', 'viewer', 'Mom');
    expect((await app.request('/api/filters', { headers: momHeaders }, env)).status).toBe(200);
    expect((await app.request('/api/admin/users', { headers: momHeaders }, env)).status).toBe(403);

    // Bootstrap admin cannot be deleted or modified
    const delBootstrap = await app.request(
      `/api/admin/users/${encodeURIComponent('owner@example.com')}`,
      { method: 'DELETE', headers: adminHeaders },
      env
    );
    expect(delBootstrap.status).toBe(400);

    // Admin can delete non-bootstrap user
    const delMom = await app.request(
      `/api/admin/users/${encodeURIComponent('mom@example.com')}`,
      { method: 'DELETE', headers: adminHeaders },
      env
    );
    expect(delMom.status).toBe(200);
    expect((await app.request('/api/filters', { headers: momHeaders }, env)).status).toBe(401);
  });
});
