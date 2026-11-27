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

  it('supports bulk album move (including unassigned) and bulk tag add/remove', async () => {
    const app = createApp();
    const { env } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');
    const jsonHeaders = { ...adminHeaders, 'Content-Type': 'application/json' };

    const albRes = await app.request(
      '/api/admin/albums',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'Family 2026' }),
      },
      env
    );
    const album = (await albRes.json()) as AlbumSummary;

    // Upload 2 unassigned images with different initial tags
    const img1 = (await (
      await app.request(
        '/api/admin/images',
        {
          method: 'POST',
          headers: adminHeaders,
          body: buildUploadForm({ metadata: { caption: 'One', tags: ['sea', 'old'] } }),
        },
        env
      )
    ).json()) as ImageItem;
    const img2 = (await (
      await app.request(
        '/api/admin/images',
        {
          method: 'POST',
          headers: adminHeaders,
          body: buildUploadForm({ metadata: { caption: 'Two', tags: ['old'] } }),
        },
        env
      )
    ).json()) as ImageItem;

    // 1. Bulk move both to album + add tags ['summer', 'family']
    const moveRes = await app.request(
      '/api/admin/images/bulk-update',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          ids: [img1.id, img2.id],
          albumId: album.id,
          addTags: ['Summer', 'family'],
        }),
      },
      env
    );
    expect(moveRes.status).toBe(200);
    expect(await moveRes.json()).toMatchObject({ ok: true, updatedCount: 2 });

    const afterAdd = (await (
      await app.request('/api/images?offset=0&limit=10', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    const byIdAfterAdd = new Map(afterAdd.items.map((i) => [i.id, i]));
    expect(byIdAfterAdd.get(img1.id)?.albumId).toBe(album.id);
    expect(byIdAfterAdd.get(img2.id)?.albumId).toBe(album.id);
    expect(byIdAfterAdd.get(img1.id)?.tags).toEqual(['family', 'old', 'sea', 'summer']);
    expect(byIdAfterAdd.get(img2.id)?.tags).toEqual(['family', 'old', 'summer']);

    // 2. Bulk remove tag 'old' and move back to unassigned (null)
    const removeRes = await app.request(
      '/api/admin/images/bulk-update',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          ids: [img1.id, img2.id],
          albumId: null,
          removeTags: ['OLD'],
        }),
      },
      env
    );
    expect(removeRes.status).toBe(200);

    const afterRemove = (await (
      await app.request('/api/images?offset=0&limit=10', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    const byIdAfterRemove = new Map(afterRemove.items.map((i) => [i.id, i]));
    expect(byIdAfterRemove.get(img1.id)?.albumId).toBeNull();
    expect(byIdAfterRemove.get(img2.id)?.albumId).toBeNull();
    expect(byIdAfterRemove.get(img1.id)?.tags).toEqual(['family', 'sea', 'summer']);
    expect(byIdAfterRemove.get(img2.id)?.tags).toEqual(['family', 'summer']);

    // 3. Reject empty action & non-existent album
    expect(
      (
        await app.request(
          '/api/admin/images/bulk-update',
          { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ids: [img1.id] }) },
          env
        )
      ).status
    ).toBe(400);

    expect(
      (
        await app.request(
          '/api/admin/images/bulk-update',
          {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ ids: [img1.id], albumId: 'non-existent-album' }),
          },
          env
        )
      ).status
    ).toBe(400);
  });

  it('safely chunks D1 IN queries for >100 images across range fetch, bulk-update, and bulk-delete', async () => {
    const app = createApp();
    const { env, sqlite, r2Store } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');
    const jsonHeaders = { ...adminHeaders, 'Content-Type': 'application/json' };

    const albumRes = await app.request(
      '/api/admin/albums',
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Big Batch' }) },
      env
    );
    const album = (await albumRes.json()) as AlbumSummary;

    // Seed 120 images directly (> D1's 100-variable per-query limit)
    const ids: string[] = [];
    const insertImg = sqlite.prepare(
      `INSERT INTO images (
         id, album_id, caption, original_filename, taken_at, has_exif_date,
         uploaded_at, uploaded_by, width, height,
         display_key, thumb_key, display_bytes, thumb_bytes
       ) VALUES (?, NULL, ?, 'p.jpg', ?, 1, ?, 'owner@example.com', 1000, 800, ?, ?, 100, 50)`
    );
    for (let i = 0; i < 120; i += 1) {
      const id = `batch-img-${String(i).padStart(4, '0')}`;
      ids.push(id);
      insertImg.run(
        id,
        `Photo ${i}`,
        1_700_000_000_000 + i,
        1_700_000_000_000,
        `display/${id}.webp`,
        `thumb/${id}.webp`
      );
      r2Store.set(`display/${id}.webp`, {
        bytes: new Uint8Array([1]),
        contentType: 'image/webp',
        etag: `d-${i}`,
      });
      r2Store.set(`thumb/${id}.webp`, {
        bytes: new Uint8Array([1]),
        contentType: 'image/webp',
        etag: `t-${i}`,
      });
    }

    // Bulk update all 120 images at once (album move + add 2 tags)
    const bulkUp = await app.request(
      '/api/admin/images/bulk-update',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ids, albumId: album.id, addTags: ['trip', '2026'] }),
      },
      env
    );
    expect(bulkUp.status).toBe(200);
    expect(await bulkUp.json()).toMatchObject({ ok: true, updatedCount: 120 });

    // Fetch all 120 in one page (limit=200) -> verifies chunked fetchTagsByImageIds
    const listRes = await app.request(
      '/api/images?offset=0&limit=200',
      { headers: adminHeaders },
      env
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as ImagesRangeResponse;
    expect(list.total).toBe(120);
    expect(list.items).toHaveLength(120);
    expect(list.items[0].albumId).toBe(album.id);
    expect(list.items[0].tags).toEqual(['2026', 'trip']);
    expect(list.items[119].tags).toEqual(['2026', 'trip']);

    // Bulk remove tag across all 120 images
    const bulkRem = await app.request(
      '/api/admin/images/bulk-update',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ids, removeTags: ['trip'] }),
      },
      env
    );
    expect(bulkRem.status).toBe(200);

    // Bulk delete all 120 images at once -> cleans both D1 and all 240 R2 keys
    const bulkDel = await app.request(
      '/api/admin/images/bulk-delete',
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ids }) },
      env
    );
    expect(bulkDel.status).toBe(200);
    expect(r2Store.size).toBe(0);
  });

  it('filters by hasExifDate=false/true and supports bulk takenAt update that marks hasExifDate=true', async () => {
    const app = createApp();
    const { env } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');
    const jsonHeaders = { ...adminHeaders, 'Content-Type': 'application/json' };

    const withExif = (await (
      await app.request(
        '/api/admin/images',
        {
          method: 'POST',
          headers: adminHeaders,
          body: buildUploadForm({
            metadata: { caption: 'Has EXIF', hasExifDate: true, takenAt: 1_700_000_000_000 },
          }),
        },
        env
      )
    ).json()) as ImageItem;

    const noExif1 = (await (
      await app.request(
        '/api/admin/images',
        {
          method: 'POST',
          headers: adminHeaders,
          body: buildUploadForm({
            metadata: { caption: 'No EXIF 1', hasExifDate: false, takenAt: null },
          }),
        },
        env
      )
    ).json()) as ImageItem;

    const noExif2 = (await (
      await app.request(
        '/api/admin/images',
        {
          method: 'POST',
          headers: adminHeaders,
          body: buildUploadForm({
            metadata: { caption: 'No EXIF 2', hasExifDate: false, takenAt: null },
          }),
        },
        env
      )
    ).json()) as ImageItem;

    // Filter only missing EXIF date -> 2 items
    const missingRes = (await (
      await app.request('/api/images?hasExifDate=false', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    expect(missingRes.total).toBe(2);
    expect(missingRes.items.map((i) => i.id).sort()).toEqual([noExif1.id, noExif2.id].sort());

    // Filter only with EXIF date -> 1 item
    const presentRes = (await (
      await app.request('/api/images?hasExifDate=true', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    expect(presentRes.total).toBe(1);
    expect(presentRes.items[0].id).toBe(withExif.id);

    // Invalid takenAt rejected with 400
    expect(
      (
        await app.request(
          '/api/admin/images/bulk-update',
          {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ ids: [noExif1.id], takenAt: -1 }),
          },
          env
        )
      ).status
    ).toBe(400);

    // Bulk assign takenAt to both missing-EXIF photos -> flips hasExifDate to true
    const targetTakenAt = Date.UTC(2024, 7, 15, 10, 30, 0);
    const bulkTakenRes = await app.request(
      '/api/admin/images/bulk-update',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ids: [noExif1.id, noExif2.id], takenAt: targetTakenAt }),
      },
      env
    );
    expect(bulkTakenRes.status).toBe(200);

    // Missing EXIF filter is now 0, and present filter has all 3 with updated takenAt
    const missingAfter = (await (
      await app.request('/api/images?hasExifDate=false', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    expect(missingAfter.total).toBe(0);

    const presentAfter = (await (
      await app.request('/api/images?hasExifDate=true', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    expect(presentAfter.total).toBe(3);
    const updatedItem = presentAfter.items.find((i) => i.id === noExif1.id);
    expect(updatedItem?.takenAt).toBe(targetTakenAt);
    expect(updatedItem?.hasExifDate).toBe(true);
  });

  it('returns timezone-aware year group counts on offset=0 for year-grouped virtual scroll', async () => {
    const app = createApp();
    const { env } = createTestEnv();
    const adminHeaders = await makeAuthHeader('owner@example.com', 'admin', 'Owner');

    // Dec 31 2025 16:00 UTC == Jan 1 2026 01:00 KST (+540 min)
    const borderTs = Date.UTC(2025, 11, 31, 16, 0, 0);
    const ts2026 = Date.UTC(2026, 5, 10, 12, 0, 0);
    const ts2024 = Date.UTC(2024, 2, 5, 12, 0, 0);

    for (const [caption, takenAt] of [
      ['2026 mid', ts2026],
      ['KST 2026 / UTC 2025', borderTs],
      ['2024 spring', ts2024],
    ] as const) {
      await app.request(
        '/api/admin/images',
        {
          method: 'POST',
          headers: adminHeaders,
          body: buildUploadForm({ metadata: { caption, hasExifDate: true, takenAt } }),
        },
        env
      );
    }

    // In UTC (tzOffset=0): 2026 (1), 2025 (1), 2024 (1)
    const utcRes = (await (
      await app.request('/api/images?offset=0&limit=40&tzOffset=0', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    expect(utcRes.years).toEqual([
      { year: 2026, count: 1 },
      { year: 2025, count: 1 },
      { year: 2024, count: 1 },
    ]);

    // In KST (tzOffset=540): 2026 (2), 2024 (1)
    const kstRes = (await (
      await app.request(
        '/api/images?offset=0&limit=40&tzOffset=540',
        { headers: adminHeaders },
        env
      )
    ).json()) as ImagesRangeResponse;
    expect(kstRes.years).toEqual([
      { year: 2026, count: 2 },
      { year: 2024, count: 1 },
    ]);

    // Filter both /api/images and /api/images/ids by year=2026 in KST (+540) -> 2 items
    const year2026Images = (await (
      await app.request('/api/images?year=2026&tzOffset=540', { headers: adminHeaders }, env)
    ).json()) as ImagesRangeResponse;
    expect(year2026Images.total).toBe(2);

    const year2026Frame = (await (
      await app.request('/api/images/ids?year=2026&tzOffset=540', { headers: adminHeaders }, env)
    ).json()) as FrameIdsResponse;
    expect(year2026Frame.total).toBe(2);

    // Filter /api/images/ids by year=2024 in KST -> 1 item
    const year2024Frame = (await (
      await app.request('/api/images/ids?year=2024&tzOffset=540', { headers: adminHeaders }, env)
    ).json()) as FrameIdsResponse;
    expect(year2024Frame.total).toBe(1);
    expect(year2024Frame.items[0].caption).toBe('2024 spring');

    // /api/filters also includes years breakdown
    const filtersWithYears = (await (
      await app.request('/api/filters?tzOffset=540', { headers: adminHeaders }, env)
    ).json()) as FiltersResponse;
    expect(filtersWithYears.years).toEqual([
      { year: 2026, count: 2 },
      { year: 2024, count: 1 },
    ]);
  });
});
