#!/usr/bin/env node
/**
 * Local End-to-End Integration Test (Phase 8)
 * Runs against built `dist/client` Static Assets + `wrangler dev` (Miniflare D1 & R2).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WRANGLER_CONFIG = existsSync(resolve(ROOT, 'wrangler.jsonc'))
  ? resolve(ROOT, 'wrangler.jsonc')
  : resolve(ROOT, 'wrangler.example.jsonc');
const PORT = 8799;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PERSIST_DIR = resolve(ROOT, `.wrangler/e2e-tmp-${process.pid}`);
const SESSION_SECRET = 'r2album-e2e-session-secret-key-32bytes!!';
const ADMIN_EMAIL = 'e2e-admin@example.com';

const textEncoder = new TextEncoder();

function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signSessionCookie(user) {
  const payload = {
    email: user.email,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(encodedPayload));
  const token = `${encodedPayload}.${toBase64Url(new Uint8Array(sig))}`;
  return `r2album_session=${encodeURIComponent(token)}`;
}

function createTestWebpBytes(label) {
  const payload = textEncoder.encode(label);
  const size = 12 + payload.length;
  const buf = new Uint8Array(size);
  buf[0] = 0x52; // R
  buf[1] = 0x49; // I
  buf[2] = 0x46; // F
  buf[3] = 0x46; // F
  const riffSize = size - 8;
  buf[4] = riffSize & 0xff;
  buf[5] = (riffSize >> 8) & 0xff;
  buf[6] = (riffSize >> 16) & 0xff;
  buf[7] = (riffSize >> 24) & 0xff;
  buf[8] = 0x57; // W
  buf[9] = 0x45; // E
  buf[10] = 0x42; // B
  buf[11] = 0x50; // P
  buf.set(payload, 12);
  return buf;
}

function buildUploadForm(meta) {
  const form = new FormData();
  const display = createTestWebpBytes(`display-${meta.caption ?? 'img'}`);
  const thumb = createTestWebpBytes(`thumb-${meta.caption ?? 'img'}`);
  form.append('display', new File([display], 'display.webp', { type: 'image/webp' }));
  form.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }));
  form.append(
    'metadata',
    JSON.stringify({
      originalFilename: 'e2e.jpg',
      width: 2048,
      height: 1536,
      hasExifDate: true,
      ...meta,
    })
  );
  return form;
}

async function waitForHealth(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ORIGIN}/api/health`);
      if (res.ok) return;
    } catch {
      // retry until ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for Wrangler dev server at ${ORIGIN}`);
}

async function main() {
  if (!existsSync(resolve(ROOT, 'dist/client/index.html'))) {
    throw new Error('dist/client/index.html not found. Run `pnpm build` first.');
  }

  mkdirSync(PERSIST_DIR, { recursive: true });

  // 1. Apply D1 migrations into isolated local Miniflare state
  const migrate = spawnSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'r2album-db',
      '--config',
      WRANGLER_CONFIG,
      '--local',
      '--persist-to',
      PERSIST_DIR,
    ],
    { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }
  );
  if (migrate.status !== 0) {
    throw new Error(`D1 migration failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }

  // 2. Start wrangler dev with built SPA assets + Miniflare D1/R2
  const server = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      WRANGLER_CONFIG,
      '--local',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      PERSIST_DIR,
      '--var',
      `SESSION_SECRET:${SESSION_SECRET}`,
      '--var',
      'GOOGLE_CLIENT_ID:e2e-google-client-id',
      '--var',
      'GOOGLE_CLIENT_SECRET:e2e-google-client-secret',
      '--var',
      `BOOTSTRAP_ADMIN_EMAIL:${ADMIN_EMAIL}`,
      '--var',
      `APP_ORIGIN:${ORIGIN}`,
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let serverLogs = '';
  server.stdout.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });

  try {
    await waitForHealth();

    // A. Built SPA Static Assets & SPA fallback routes
    for (const spaPath of ['/', '/admin', '/login']) {
      const spaRes = await fetch(`${ORIGIN}${spaPath}`);
      assert.equal(spaRes.status, 200, `SPA route ${spaPath} should return 200`);
      const html = await spaRes.text();
      assert.match(html, /id="app"/, `SPA route ${spaPath} should render app mount root`);
    }

    // B. Unauthenticated guards & OAuth PKCE redirect
    const meAnon = await (await fetch(`${ORIGIN}/api/me`)).json();
    assert.deepEqual(meAnon, { authenticated: false });
    assert.equal((await fetch(`${ORIGIN}/api/images`)).status, 401);
    assert.equal((await fetch(`${ORIGIN}/api/admin/stats`)).status, 401);

    const oauthStart = await fetch(`${ORIGIN}/auth/google`, { redirect: 'manual' });
    assert.equal(oauthStart.status, 302);
    const location = oauthStart.headers.get('location') ?? '';
    assert.match(location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    assert.match(location, /code_challenge_method=S256/);
    assert.match(oauthStart.headers.get('set-cookie') ?? '', /r2album_oauth_state=/);

    // C. Authenticated Admin E2E flow
    const adminCookie = await signSessionCookie({
      email: ADMIN_EMAIL,
      name: 'E2E Owner',
      role: 'admin',
    });
    const adminHeaders = { Cookie: adminCookie };
    const adminJsonHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };

    const meAdmin = await (await fetch(`${ORIGIN}/api/me`, { headers: adminHeaders })).json();
    assert.equal(meAdmin.authenticated, true);
    assert.equal(meAdmin.user.role, 'admin');

    // Create album
    const albumRes = await fetch(`${ORIGIN}/api/admin/albums`, {
      method: 'POST',
      headers: adminJsonHeaders,
      body: JSON.stringify({ name: 'Jeju E2E', description: 'Integration test album' }),
    });
    assert.equal(albumRes.status, 201);
    const album = await albumRes.json();

    // Upload 3 WebP images with distinct EXIF takenAt timestamps
    const uploads = [
      { takenAt: 1_700_000_010_000, caption: 'Oldest', albumId: album.id, tags: ['beach', 'jeju'] },
      { takenAt: 1_700_000_030_000, caption: 'Newest', albumId: album.id, tags: ['jeju'] },
      { takenAt: 1_700_000_020_000, caption: 'Middle', albumId: null, tags: ['beach'] },
    ];
    const uploaded = [];
    for (const meta of uploads) {
      const upRes = await fetch(`${ORIGIN}/api/admin/images`, {
        method: 'POST',
        headers: adminHeaders,
        body: buildUploadForm(meta),
      });
      assert.equal(upRes.status, 201, `Upload ${meta.caption} should succeed`);
      uploaded.push(await upRes.json());
    }

    // Range pagination ordered by taken_at DESC
    const page1 = await (
      await fetch(`${ORIGIN}/api/images?offset=0&limit=2`, { headers: adminHeaders })
    ).json();
    assert.equal(page1.total, 3);
    assert.deepEqual(
      page1.items.map((i) => i.caption),
      ['Newest', 'Middle']
    );

    const page2 = await (
      await fetch(`${ORIGIN}/api/images?offset=2&limit=2`, { headers: adminHeaders })
    ).json();
    assert.deepEqual(
      page2.items.map((i) => i.caption),
      ['Oldest']
    );

    // Filters & PhotoFrame IDs scoped by album
    const filters = await (await fetch(`${ORIGIN}/api/filters`, { headers: adminHeaders })).json();
    assert.equal(filters.totalImages, 3);
    assert.equal(filters.albums[0].imageCount, 2);

    const frameIds = await (
      await fetch(`${ORIGIN}/api/images/ids?albumId=${encodeURIComponent(album.id)}`, {
        headers: adminHeaders,
      })
    ).json();
    assert.equal(frameIds.total, 2);
    assert.deepEqual(
      frameIds.items.map((f) => f.caption),
      ['Newest', 'Oldest']
    );

    // Private R2 media streaming + Cache-Control + ETag 304 + unauthenticated 401
    const sample = uploaded[0];
    assert.equal((await fetch(`${ORIGIN}${sample.displayUrl}`)).status, 401);

    const mediaRes = await fetch(`${ORIGIN}${sample.displayUrl}`, { headers: adminHeaders });
    assert.equal(mediaRes.status, 200);
    assert.equal(mediaRes.headers.get('content-type'), 'image/webp');
    assert.equal(
      mediaRes.headers.get('cache-control'),
      'private, max-age=31536000, immutable'
    );
    const etag = mediaRes.headers.get('etag');
    assert.ok(etag, 'ETag header must be present');

    const media304 = await fetch(`${ORIGIN}${sample.displayUrl}`, {
      headers: { ...adminHeaders, 'If-None-Match': etag },
    });
    assert.equal(media304.status, 304);

    // Inline metadata update & storage stats
    const patchRes = await fetch(`${ORIGIN}/api/admin/images/${sample.id}`, {
      method: 'PATCH',
      headers: adminJsonHeaders,
      body: JSON.stringify({ caption: 'Updated Oldest', tags: ['sunset'] }),
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.caption, 'Updated Oldest');
    assert.deepEqual(patched.tags, ['sunset']);

    const stats = await (await fetch(`${ORIGIN}/api/admin/stats`, { headers: adminHeaders })).json();
    assert.equal(stats.totalImages, 3);
    assert.ok(stats.totalBytes > 0);

    // Viewer RBAC & instant revocation on delete
    const viewerEmail = 'viewer-e2e@example.com';
    const addViewer = await fetch(`${ORIGIN}/api/admin/users`, {
      method: 'POST',
      headers: adminJsonHeaders,
      body: JSON.stringify({ email: viewerEmail, name: 'Family', role: 'viewer' }),
    });
    assert.equal(addViewer.status, 201);

    const viewerHeaders = {
      Cookie: await signSessionCookie({ email: viewerEmail, name: 'Family', role: 'viewer' }),
    };
    assert.equal((await fetch(`${ORIGIN}/api/images`, { headers: viewerHeaders })).status, 200);
    assert.equal(
      (await fetch(`${ORIGIN}${sample.thumbUrl}`, { headers: viewerHeaders })).status,
      200
    );
    assert.equal((await fetch(`${ORIGIN}/api/admin/stats`, { headers: viewerHeaders })).status, 403);

    // Delete single + bulk delete -> R2 objects return 404
    assert.equal(
      (
        await fetch(`${ORIGIN}/api/admin/images/${uploaded[0].id}`, {
          method: 'DELETE',
          headers: adminHeaders,
        })
      ).status,
      200
    );
    assert.equal(
      (await fetch(`${ORIGIN}${uploaded[0].displayUrl}`, { headers: adminHeaders })).status,
      404
    );

    const bulkDel = await fetch(`${ORIGIN}/api/admin/images/bulk-delete`, {
      method: 'POST',
      headers: adminJsonHeaders,
      body: JSON.stringify({ ids: [uploaded[1].id, uploaded[2].id] }),
    });
    assert.equal(bulkDel.status, 200);
    assert.equal(
      (await fetch(`${ORIGIN}${uploaded[1].thumbUrl}`, { headers: adminHeaders })).status,
      404
    );

    // Delete album & revoke viewer
    assert.equal(
      (
        await fetch(`${ORIGIN}/api/admin/albums/${album.id}`, {
          method: 'DELETE',
          headers: adminHeaders,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${ORIGIN}/api/admin/users/${encodeURIComponent(viewerEmail)}`, {
          method: 'DELETE',
          headers: adminHeaders,
        })
      ).status,
      200
    );
    assert.equal((await fetch(`${ORIGIN}/api/images`, { headers: viewerHeaders })).status, 401);

    // Logout clears session cookie
    const logoutRes = await fetch(`${ORIGIN}/auth/logout`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get('set-cookie') ?? '', /Max-Age=0/);

    console.log('✅ Local Wrangler E2E integration test passed (SPA + D1 + R2 + Auth + RBAC + CRUD)');
  } catch (err) {
    console.error('❌ Local E2E test failed. Wrangler logs:\n', serverLogs);
    throw err;
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    rmSync(PERSIST_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
