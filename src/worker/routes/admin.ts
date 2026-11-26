import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  BULK_DELETE_MAX,
  DISPLAY_MAX_BYTES,
  R2_FREE_TIER_BYTES,
  TAG_MAX_COUNT,
  THUMB_MAX_BYTES,
} from '../../shared/constants';
import type {
  AdminStatsResponse,
  AdminUsersResponse,
  AlbumSummary,
  AllowedUserRecord,
  ImageItem,
  UserApprovalStatus,
  UserRole,
} from '../../shared/types';
import type { AppEnv } from '../auth/middleware';
import { ApiError } from '../errors';
import {
  isValidImageId,
  isValidWebpBytes,
  normalizeAlbumName,
  normalizeCaption,
  normalizeEmail,
  normalizeTags,
} from '../validation';
import { buildMediaUrls, fetchTagsByImageIds } from './images';

async function syncImageTags(db: D1Database, imageId: string, tags: string[]): Promise<void> {
  await db.prepare('DELETE FROM image_tags WHERE image_id = ?').bind(imageId).run();

  for (const tagName of tags) {
    await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(tagName).run();
    const tagRow = await db
      .prepare('SELECT id FROM tags WHERE name = ?')
      .bind(tagName)
      .first<{ id: number }>();
    if (tagRow) {
      await db
        .prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
        .bind(imageId, tagRow.id)
        .run();
    }
  }
}

async function loadImageItemById(db: D1Database, id: string): Promise<ImageItem | null> {
  const row = await db
    .prepare(
      `SELECT i.id, i.album_id, a.name AS album_name, i.caption,
              i.taken_at, i.has_exif_date, i.uploaded_at, i.width, i.height
       FROM images i
       LEFT JOIN albums a ON a.id = i.album_id
       WHERE i.id = ?`
    )
    .bind(id)
    .first<{
      id: string;
      album_id: string | null;
      album_name: string | null;
      caption: string;
      taken_at: number;
      has_exif_date: number;
      uploaded_at: number;
      width: number;
      height: number;
    }>();

  if (!row) return null;
  const tagsMap = await fetchTagsByImageIds(db, [row.id]);
  const urls = buildMediaUrls(row.id);

  return {
    id: row.id,
    albumId: row.album_id ?? null,
    albumName: row.album_name ?? null,
    caption: row.caption ?? '',
    tags: tagsMap.get(row.id) ?? [],
    takenAt: Number(row.taken_at),
    hasExifDate: Number(row.has_exif_date) === 1,
    uploadedAt: Number(row.uploaded_at),
    width: Number(row.width),
    height: Number(row.height),
    thumbUrl: urls.thumbUrl,
    displayUrl: urls.displayUrl,
  };
}

function isFileLike(val: unknown): val is File {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Blob).arrayBuffer === 'function' &&
    typeof (val as Blob).size === 'number'
  );
}

export function createAdminRoutes() {
  const admin = new Hono<AppEnv>();

  // --- Stats ---
  admin.get('/api/admin/stats', async (c) => {
    const db = c.env.DB;
    const [imgStats, pendingRow] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) AS total_images,
                  COALESCE(SUM(display_bytes), 0) AS total_display_bytes,
                  COALESCE(SUM(thumb_bytes), 0) AS total_thumb_bytes
           FROM images`
        )
        .first<{
          total_images: number;
          total_display_bytes: number;
          total_thumb_bytes: number;
        }>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM allowed_users WHERE status = 'pending'")
        .first<{ count: number }>(),
    ]);

    const totalDisplayBytes = Number(imgStats?.total_display_bytes ?? 0);
    const totalThumbBytes = Number(imgStats?.total_thumb_bytes ?? 0);
    const totalBytes = totalDisplayBytes + totalThumbBytes;

    const body: AdminStatsResponse = {
      totalImages: Number(imgStats?.total_images ?? 0),
      totalDisplayBytes,
      totalThumbBytes,
      totalBytes,
      freeTierBytes: R2_FREE_TIER_BYTES,
      usageRatio: totalBytes / R2_FREE_TIER_BYTES,
      pendingUsers: Number(pendingRow?.count ?? 0),
    };
    return c.json(body);
  });

  // --- Image Upload (Worker R2 Native Binding, DC-5) ---
  admin.post('/api/admin/images', async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      throw new ApiError(400, 'INVALID_MULTIPART', 'Expected multipart/form-data request');
    }

    const displayEntry = formData.get('display');
    const thumbEntry = formData.get('thumb');
    const rawMetadata = formData.get('metadata');

    if (!isFileLike(displayEntry) || !isFileLike(thumbEntry)) {
      throw new ApiError(400, 'MISSING_MEDIA', 'Both display and thumb WebP files are required');
    }

    if (displayEntry.size === 0 || thumbEntry.size === 0) {
      throw new ApiError(400, 'EMPTY_FILE', 'Uploaded image files cannot be empty');
    }
    if (displayEntry.size > DISPLAY_MAX_BYTES) {
      throw new ApiError(
        413,
        'DISPLAY_TOO_LARGE',
        `Display image exceeds maximum size (${DISPLAY_MAX_BYTES} bytes)`
      );
    }
    if (thumbEntry.size > THUMB_MAX_BYTES) {
      throw new ApiError(
        413,
        'THUMB_TOO_LARGE',
        `Thumbnail image exceeds maximum size (${THUMB_MAX_BYTES} bytes)`
      );
    }

    let meta: Record<string, unknown>;
    try {
      meta =
        typeof rawMetadata === 'string' && rawMetadata.trim()
          ? (JSON.parse(rawMetadata) as Record<string, unknown>)
          : {};
    } catch {
      throw new ApiError(400, 'INVALID_METADATA', 'metadata must be valid JSON');
    }

    const displayBytes = new Uint8Array(await displayEntry.arrayBuffer());
    const thumbBytes = new Uint8Array(await thumbEntry.arrayBuffer());

    if (!isValidWebpBytes(displayBytes) || !isValidWebpBytes(thumbBytes)) {
      throw new ApiError(400, 'INVALID_WEBP', 'Uploaded files must be valid WebP images');
    }

    const originalFilename =
      typeof meta.originalFilename === 'string' && meta.originalFilename.trim()
        ? meta.originalFilename.trim().slice(0, 255)
        : 'photo.webp';

    const width = Number(meta.width);
    const height = Number(meta.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new ApiError(400, 'INVALID_DIMENSIONS', 'Positive integer width and height required');
    }

    const uploadedAt = Date.now();
    const hasExifDate = meta.hasExifDate === true;
    const rawTakenAt = Number(meta.takenAt);
    const takenAt =
      hasExifDate && Number.isFinite(rawTakenAt) && rawTakenAt > 0
        ? Math.floor(rawTakenAt)
        : uploadedAt;

    const caption = normalizeCaption(meta.caption);
    const tags = normalizeTags(meta.tags);
    const albumId =
      typeof meta.albumId === 'string' && meta.albumId.trim() ? meta.albumId.trim() : null;

    const db = c.env.DB;
    if (albumId) {
      const albumExists = await db
        .prepare('SELECT id FROM albums WHERE id = ?')
        .bind(albumId)
        .first<{ id: string }>();
      if (!albumExists) {
        throw new ApiError(400, 'ALBUM_NOT_FOUND', 'Specified album does not exist');
      }
    }

    const id = crypto.randomUUID();
    const displayKey = `display/${id}.webp`;
    const thumbKey = `thumb/${id}.webp`;
    const uploaderEmail = c.get('user').email;

    // 1. Write both WebP variants to Private R2
    await Promise.all([
      c.env.MEDIA_BUCKET.put(displayKey, displayBytes, {
        httpMetadata: { contentType: 'image/webp' },
      }),
      c.env.MEDIA_BUCKET.put(thumbKey, thumbBytes, {
        httpMetadata: { contentType: 'image/webp' },
      }),
    ]);

    // 2. Write metadata to D1 with R2 rollback if D1 fails
    try {
      await db
        .prepare(
          `INSERT INTO images (
             id, album_id, caption, original_filename, taken_at, has_exif_date,
             uploaded_at, uploaded_by, width, height,
             display_key, thumb_key, display_bytes, thumb_bytes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          albumId,
          caption,
          originalFilename,
          takenAt,
          hasExifDate ? 1 : 0,
          uploadedAt,
          uploaderEmail,
          width,
          height,
          displayKey,
          thumbKey,
          displayBytes.byteLength,
          thumbBytes.byteLength
        )
        .run();

      if (tags.length > 0) {
        await syncImageTags(db, id, tags);
      }
    } catch (err) {
      try {
        await c.env.MEDIA_BUCKET.delete([displayKey, thumbKey]);
      } catch (cleanupErr) {
        console.error('[r2album] R2 rollback delete failed:', cleanupErr);
      }
      throw err;
    }

    const created = await loadImageItemById(db, id);
    return c.json(created, 201);
  });

  // --- Image Update ---
  admin.patch('/api/admin/images/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidImageId(id)) {
      throw new ApiError(400, 'INVALID_IMAGE_ID', 'Invalid image ID');
    }

    const db = c.env.DB;
    const existing = await db
      .prepare('SELECT id, album_id, caption, taken_at, has_exif_date FROM images WHERE id = ?')
      .bind(id)
      .first<{
        id: string;
        album_id: string | null;
        caption: string;
        taken_at: number;
        has_exif_date: number;
      }>();

    if (!existing) {
      throw new ApiError(404, 'IMAGE_NOT_FOUND', 'Image not found');
    }

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new ApiError(400, 'INVALID_BODY', 'JSON body is required');
    }

    const nextCaption = 'caption' in body ? normalizeCaption(body.caption) : existing.caption;

    let nextAlbumId: string | null = existing.album_id;
    if ('albumId' in body) {
      if (body.albumId === null || body.albumId === '') {
        nextAlbumId = null;
      } else if (typeof body.albumId === 'string') {
        const found = await db
          .prepare('SELECT id FROM albums WHERE id = ?')
          .bind(body.albumId.trim())
          .first<{ id: string }>();
        if (!found) {
          throw new ApiError(400, 'ALBUM_NOT_FOUND', 'Specified album does not exist');
        }
        nextAlbumId = found.id;
      } else {
        throw new ApiError(400, 'INVALID_ALBUM_ID', 'albumId must be a string or null');
      }
    }

    let nextTakenAt = Number(existing.taken_at);
    let nextHasExifDate = Number(existing.has_exif_date);
    if ('takenAt' in body) {
      const parsed = Number(body.takenAt);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ApiError(400, 'INVALID_TAKEN_AT', 'takenAt must be a positive timestamp');
      }
      nextTakenAt = Math.floor(parsed);
      nextHasExifDate = 1;
    }

    await db
      .prepare(
        'UPDATE images SET album_id = ?, caption = ?, taken_at = ?, has_exif_date = ? WHERE id = ?'
      )
      .bind(nextAlbumId, nextCaption, nextTakenAt, nextHasExifDate, id)
      .run();

    if ('tags' in body) {
      const tags = normalizeTags(body.tags);
      await syncImageTags(db, id, tags);
    }

    const updated = await loadImageItemById(db, id);
    return c.json(updated);
  });

  // --- Image Single Delete ---
  admin.delete('/api/admin/images/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidImageId(id)) {
      throw new ApiError(400, 'INVALID_IMAGE_ID', 'Invalid image ID');
    }

    const db = c.env.DB;
    const row = await db
      .prepare('SELECT display_key, thumb_key FROM images WHERE id = ?')
      .bind(id)
      .first<{ display_key: string; thumb_key: string }>();

    if (!row) {
      throw new ApiError(404, 'IMAGE_NOT_FOUND', 'Image not found');
    }

    await db.prepare('DELETE FROM image_tags WHERE image_id = ?').bind(id).run();
    await db.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
    await c.env.MEDIA_BUCKET.delete([row.display_key, row.thumb_key]);

    return c.json({ ok: true, deletedId: id });
  });

  // --- Image Bulk Delete ---
  admin.post('/api/admin/images/bulk-delete', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new ApiError(400, 'INVALID_IDS', 'ids must be a non-empty array');
    }
    if (body.ids.length > BULK_DELETE_MAX) {
      throw new ApiError(
        400,
        'TOO_MANY_IDS',
        `At most ${BULK_DELETE_MAX} images can be deleted per request`
      );
    }

    const uniqueIds = Array.from(
      new Set(
        body.ids.map((raw) => {
          if (typeof raw !== 'string' || !isValidImageId(raw)) {
            throw new ApiError(400, 'INVALID_IMAGE_ID', 'Invalid image ID in list');
          }
          return raw;
        })
      )
    );

    const db = c.env.DB;
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, display_key, thumb_key FROM images WHERE id IN (${placeholders})`)
      .bind(...uniqueIds)
      .all<{ id: string; display_key: string; thumb_key: string }>();

    const found = results ?? [];
    if (found.length === 0) {
      return c.json({ ok: true, deletedIds: [] });
    }

    const foundIds = found.map((r) => r.id);
    const foundPlaceholders = foundIds.map(() => '?').join(', ');
    await db
      .prepare(`DELETE FROM image_tags WHERE image_id IN (${foundPlaceholders})`)
      .bind(...foundIds)
      .run();
    await db
      .prepare(`DELETE FROM images WHERE id IN (${foundPlaceholders})`)
      .bind(...foundIds)
      .run();

    const r2Keys = found.flatMap((r) => [r.display_key, r.thumb_key]);
    await c.env.MEDIA_BUCKET.delete(r2Keys);

    return c.json({ ok: true, deletedIds: foundIds });
  });

  // --- Image Bulk Update (Move Album / Add or Remove Tags) ---
  admin.post('/api/admin/images/bulk-update', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new ApiError(400, 'INVALID_IDS', 'ids must be a non-empty array');
    }
    if (body.ids.length > BULK_DELETE_MAX) {
      throw new ApiError(
        400,
        'TOO_MANY_IDS',
        `At most ${BULK_DELETE_MAX} images can be updated per request`
      );
    }

    const uniqueIds = Array.from(
      new Set(
        body.ids.map((raw) => {
          if (typeof raw !== 'string' || !isValidImageId(raw)) {
            throw new ApiError(400, 'INVALID_IMAGE_ID', 'Invalid image ID in list');
          }
          return raw;
        })
      )
    );

    const hasAlbumChange = 'albumId' in body && body.albumId !== undefined;
    const addTags = 'addTags' in body ? normalizeTags(body.addTags) : [];
    const removeTags = 'removeTags' in body ? normalizeTags(body.removeTags) : [];

    if (!hasAlbumChange && addTags.length === 0 && removeTags.length === 0) {
      throw new ApiError(
        400,
        'NO_BULK_ACTION',
        'At least one of albumId, addTags, or removeTags must be provided'
      );
    }

    const db = c.env.DB;
    let nextAlbumId: string | null = null;
    if (hasAlbumChange) {
      if (body.albumId === null || body.albumId === '') {
        nextAlbumId = null;
      } else if (typeof body.albumId === 'string') {
        const trimmed = body.albumId.trim();
        const foundAlbum = await db
          .prepare('SELECT id FROM albums WHERE id = ?')
          .bind(trimmed)
          .first<{ id: string }>();
        if (!foundAlbum) {
          throw new ApiError(400, 'ALBUM_NOT_FOUND', 'Specified album does not exist');
        }
        nextAlbumId = foundAlbum.id;
      } else {
        throw new ApiError(400, 'INVALID_ALBUM_ID', 'albumId must be a string or null');
      }
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id FROM images WHERE id IN (${placeholders})`)
      .bind(...uniqueIds)
      .all<{ id: string }>();

    const foundIds = (results ?? []).map((r) => r.id);
    if (foundIds.length === 0) {
      return c.json({ ok: true, updatedIds: [], updatedCount: 0 });
    }

    // Validate per-image tag count ceiling before writing when adding tags
    if (addTags.length > 0) {
      const existingTagsMap = await fetchTagsByImageIds(db, foundIds);
      const removeSet = new Set(removeTags);
      for (const imageId of foundIds) {
        const merged = new Set(
          (existingTagsMap.get(imageId) ?? []).filter((t) => !removeSet.has(t))
        );
        for (const t of addTags) {
          merged.add(t);
        }
        if (merged.size > TAG_MAX_COUNT) {
          throw new ApiError(
            400,
            'TOO_MANY_TAGS',
            `Adding tags would exceed the maximum of ${TAG_MAX_COUNT} tags per image`
          );
        }
      }
    }

    const foundPlaceholders = foundIds.map(() => '?').join(', ');

    if (hasAlbumChange) {
      await db
        .prepare(`UPDATE images SET album_id = ? WHERE id IN (${foundPlaceholders})`)
        .bind(nextAlbumId, ...foundIds)
        .run();
    }

    if (removeTags.length > 0) {
      const tagPlaceholders = removeTags.map(() => '?').join(', ');
      await db
        .prepare(
          `DELETE FROM image_tags
           WHERE image_id IN (${foundPlaceholders})
             AND tag_id IN (SELECT id FROM tags WHERE name IN (${tagPlaceholders}))`
        )
        .bind(...foundIds, ...removeTags)
        .run();
    }

    if (addTags.length > 0) {
      for (const tagName of addTags) {
        await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(tagName).run();
        const tagRow = await db
          .prepare('SELECT id FROM tags WHERE name = ?')
          .bind(tagName)
          .first<{ id: number }>();
        if (tagRow) {
          for (const imageId of foundIds) {
            await db
              .prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
              .bind(imageId, tagRow.id)
              .run();
          }
        }
      }
    }

    return c.json({ ok: true, updatedIds: foundIds, updatedCount: foundIds.length });
  });

  // --- Albums CRUD ---
  admin.post('/api/admin/albums', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      throw new ApiError(400, 'INVALID_BODY', 'JSON body is required');
    }

    const name = normalizeAlbumName(body.name);
    const description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';

    const db = c.env.DB;
    const dup = await db
      .prepare('SELECT id FROM albums WHERE LOWER(name) = LOWER(?)')
      .bind(name)
      .first<{ id: string }>();
    if (dup) {
      throw new ApiError(409, 'ALBUM_EXISTS', 'An album with this name already exists');
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO albums (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(id, name, description, now, now)
      .run();

    const album: AlbumSummary = {
      id,
      name,
      description,
      imageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    return c.json(album, 201);
  });

  admin.patch('/api/admin/albums/:id', async (c) => {
    const id = c.req.param('id');
    const db = c.env.DB;
    const existing = await db
      .prepare('SELECT id, name, description, created_at FROM albums WHERE id = ?')
      .bind(id)
      .first<{ id: string; name: string; description: string; created_at: number }>();

    if (!existing) {
      throw new ApiError(404, 'ALBUM_NOT_FOUND', 'Album not found');
    }

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      throw new ApiError(400, 'INVALID_BODY', 'JSON body is required');
    }

    const nextName = 'name' in body ? normalizeAlbumName(body.name) : existing.name;
    const nextDescription =
      'description' in body && typeof body.description === 'string'
        ? body.description.trim().slice(0, 300)
        : existing.description;

    const dup = await db
      .prepare('SELECT id FROM albums WHERE LOWER(name) = LOWER(?) AND id != ?')
      .bind(nextName, id)
      .first<{ id: string }>();
    if (dup) {
      throw new ApiError(409, 'ALBUM_EXISTS', 'An album with this name already exists');
    }

    const now = Date.now();
    await db
      .prepare('UPDATE albums SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .bind(nextName, nextDescription, now, id)
      .run();

    const countRow = await db
      .prepare('SELECT COUNT(*) AS count FROM images WHERE album_id = ?')
      .bind(id)
      .first<{ count: number }>();

    const album: AlbumSummary = {
      id,
      name: nextName,
      description: nextDescription,
      imageCount: Number(countRow?.count ?? 0),
      createdAt: Number(existing.created_at),
      updatedAt: now,
    };
    return c.json(album);
  });

  admin.delete('/api/admin/albums/:id', async (c) => {
    const id = c.req.param('id');
    const db = c.env.DB;
    const existing = await db
      .prepare('SELECT id FROM albums WHERE id = ?')
      .bind(id)
      .first<{ id: string }>();
    if (!existing) {
      throw new ApiError(404, 'ALBUM_NOT_FOUND', 'Album not found');
    }

    await db.prepare('UPDATE images SET album_id = NULL WHERE album_id = ?').bind(id).run();
    await db.prepare('DELETE FROM albums WHERE id = ?').bind(id).run();
    return c.json({ ok: true, deletedId: id });
  });

  // --- Allowed Users & Signup Approval Management (DC-3, DC-11) ---
  admin.get('/api/admin/users', async (c) => {
    const db = c.env.DB;
    const bootstrapEmail = c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? '';

    const { results } = await db
      .prepare(
        `SELECT email, name, role, status, note, created_at, updated_at
         FROM allowed_users
         ORDER BY
           CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END ASC,
           created_at DESC`
      )
      .all<{
        email: string;
        name: string;
        role: UserRole;
        status: UserApprovalStatus;
        note: string;
        created_at: number;
        updated_at: number;
      }>();

    const users: AllowedUserRecord[] = (results ?? []).map((row) => ({
      email: row.email,
      name: row.name ?? '',
      role: row.role,
      status: row.status,
      note: row.note ?? '',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at || row.created_at),
      isBootstrapAdmin: row.email === bootstrapEmail,
    }));

    if (bootstrapEmail && !users.some((u) => u.email === bootstrapEmail)) {
      users.push({
        email: bootstrapEmail,
        name: 'Bootstrap Admin',
        role: 'admin',
        status: 'approved',
        note: 'Environment bootstrap admin',
        createdAt: 0,
        updatedAt: 0,
        isBootstrapAdmin: true,
      });
    }

    const pendingCount = users.filter((u) => u.status === 'pending').length;
    const body: AdminUsersResponse = {
      pendingCount,
      users,
    };
    return c.json(body);
  });

  admin.post('/api/admin/users', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      throw new ApiError(400, 'INVALID_BODY', 'JSON body is required');
    }

    const email = normalizeEmail(body.email);
    const role: UserRole = body.role === 'admin' ? 'admin' : 'viewer';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
    const bootstrapEmail = c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? '';

    if (email === bootstrapEmail && role !== 'admin') {
      throw new ApiError(
        400,
        'CANNOT_MODIFY_BOOTSTRAP_ADMIN',
        'Bootstrap admin role cannot be downgraded'
      );
    }

    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO allowed_users (email, name, role, status, note, created_at, updated_at)
       VALUES (?, ?, ?, 'approved', ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE allowed_users.name END,
         role = excluded.role,
         status = 'approved',
         note = excluded.note,
         updated_at = excluded.updated_at`
    )
      .bind(email, name, role, note, now, now)
      .run();

    const record: AllowedUserRecord = {
      email,
      name,
      role,
      status: 'approved',
      note,
      createdAt: now,
      updatedAt: now,
      isBootstrapAdmin: email === bootstrapEmail,
    };
    return c.json(record, 201);
  });

  admin.patch('/api/admin/users/:email', async (c) => {
    const email = normalizeEmail(decodeURIComponent(c.req.param('email')));
    const bootstrapEmail = c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
    if (email === bootstrapEmail) {
      throw new ApiError(
        400,
        'CANNOT_MODIFY_BOOTSTRAP_ADMIN',
        'Bootstrap admin cannot be modified'
      );
    }

    const db = c.env.DB;
    const existing = await db
      .prepare(
        'SELECT email, name, role, status, note, created_at FROM allowed_users WHERE email = ?'
      )
      .bind(email)
      .first<{
        email: string;
        name: string;
        role: UserRole;
        status: UserApprovalStatus;
        note: string;
        created_at: number;
      }>();

    if (!existing) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User record not found');
    }

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      throw new ApiError(400, 'INVALID_BODY', 'JSON body is required');
    }

    let nextRole: UserRole = existing.role;
    if ('role' in body) {
      if (body.role !== 'admin' && body.role !== 'viewer') {
        throw new ApiError(400, 'INVALID_ROLE', 'role must be "admin" or "viewer"');
      }
      nextRole = body.role;
    }

    let nextStatus: UserApprovalStatus = existing.status;
    if ('status' in body) {
      if (body.status !== 'pending' && body.status !== 'approved' && body.status !== 'rejected') {
        throw new ApiError(400, 'INVALID_STATUS', 'status must be pending, approved, or rejected');
      }
      nextStatus = body.status;
    }

    const nextNote =
      'note' in body && typeof body.note === 'string'
        ? body.note.trim().slice(0, 200)
        : existing.note;

    const now = Date.now();
    await db
      .prepare(
        'UPDATE allowed_users SET role = ?, status = ?, note = ?, updated_at = ? WHERE email = ?'
      )
      .bind(nextRole, nextStatus, nextNote, now, email)
      .run();

    const updated: AllowedUserRecord = {
      email,
      name: existing.name ?? '',
      role: nextRole,
      status: nextStatus,
      note: nextNote,
      createdAt: Number(existing.created_at),
      updatedAt: now,
      isBootstrapAdmin: false,
    };
    return c.json(updated);
  });

  admin.delete('/api/admin/users/:email', async (c) => {
    const email = normalizeEmail(decodeURIComponent(c.req.param('email')));
    const bootstrapEmail = c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
    if (email === bootstrapEmail) {
      throw new ApiError(400, 'CANNOT_DELETE_BOOTSTRAP_ADMIN', 'Bootstrap admin cannot be deleted');
    }

    const result = await c.env.DB.prepare('DELETE FROM allowed_users WHERE email = ?')
      .bind(email)
      .run();

    if (result.meta?.changes === 0) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User record not found');
    }

    return c.json({ ok: true, deletedEmail: email });
  });

  return admin;
}
