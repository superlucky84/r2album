import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { CHUNK_SIZE, MAX_PAGE_LIMIT } from '../../shared/constants';
import type {
  AlbumSummary,
  FiltersResponse,
  FrameIdsResponse,
  FrameItem,
  ImageItem,
  ImagesRangeResponse,
  TagSummary,
} from '../../shared/types';
import type { AppEnv } from '../auth/middleware';

interface ImageDbRow {
  id: string;
  album_id: string | null;
  album_name: string | null;
  caption: string;
  taken_at: number;
  has_exif_date: number;
  uploaded_at: number;
  width: number;
  height: number;
}

interface FrameDbRow {
  id: string;
  caption: string;
  taken_at: number;
  width: number;
  height: number;
}

export function buildMediaUrls(id: string) {
  return {
    thumbUrl: `/api/media/thumb/${id}`,
    displayUrl: `/api/media/display/${id}`,
  };
}

export async function fetchTagsByImageIds(
  db: D1Database,
  imageIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (imageIds.length === 0) return map;

  const placeholders = imageIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT it.image_id, t.name
       FROM image_tags it
       INNER JOIN tags t ON t.id = it.tag_id
       WHERE it.image_id IN (${placeholders})
       ORDER BY t.name ASC`
    )
    .bind(...imageIds)
    .all<{ image_id: string; name: string }>();

  for (const row of results ?? []) {
    const existing = map.get(row.image_id);
    if (existing) {
      existing.push(row.name);
    } else {
      map.set(row.image_id, [row.name]);
    }
  }
  return map;
}

function buildFilterWhere(params: { albumId?: string; tag?: string }) {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (params.albumId) {
    if (params.albumId === '__unassigned__') {
      conditions.push('i.album_id IS NULL');
    } else {
      conditions.push('i.album_id = ?');
      binds.push(params.albumId);
    }
  }

  if (params.tag) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM image_tags it
        INNER JOIN tags t ON t.id = it.tag_id
        WHERE it.image_id = i.id AND t.name = ?
      )`
    );
    binds.push(params.tag.trim().toLowerCase());
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, binds };
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function createImageRoutes() {
  const images = new Hono<AppEnv>();

  images.get('/api/filters', async (c) => {
    const db = c.env.DB;

    const [totalRow, albumRows, tagRows] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS count FROM images').first<{ count: number }>(),
      db
        .prepare(
          `SELECT a.id, a.name, a.description, a.created_at, a.updated_at,
                  COUNT(i.id) AS image_count
           FROM albums a
           LEFT JOIN images i ON i.album_id = a.id
           GROUP BY a.id
           ORDER BY a.name ASC`
        )
        .all<{
          id: string;
          name: string;
          description: string;
          created_at: number;
          updated_at: number;
          image_count: number;
        }>(),
      db
        .prepare(
          `SELECT t.id, t.name, COUNT(it.image_id) AS image_count
           FROM tags t
           INNER JOIN image_tags it ON it.tag_id = t.id
           GROUP BY t.id
           ORDER BY image_count DESC, t.name ASC`
        )
        .all<{ id: number; name: string; image_count: number }>(),
    ]);

    const albums: AlbumSummary[] = (albumRows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      imageCount: Number(row.image_count ?? 0),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));

    const tags: TagSummary[] = (tagRows.results ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      imageCount: Number(row.image_count ?? 0),
    }));

    const body: FiltersResponse = {
      albums,
      tags,
      totalImages: Number(totalRow?.count ?? 0),
    };
    return c.json(body);
  });

  images.get('/api/images', async (c) => {
    const db = c.env.DB;
    const offset = parseNonNegativeInt(c.req.query('offset'), 0);
    const requestedLimit = parseNonNegativeInt(c.req.query('limit'), CHUNK_SIZE);
    const limit = Math.min(Math.max(1, requestedLimit || CHUNK_SIZE), MAX_PAGE_LIMIT);
    const albumId = c.req.query('albumId')?.trim() || undefined;
    const tag = c.req.query('tag')?.trim() || undefined;

    const { whereSql, binds } = buildFilterWhere({ albumId, tag });

    const countRow = await db
      .prepare(`SELECT COUNT(*) AS count FROM images i ${whereSql}`)
      .bind(...binds)
      .first<{ count: number }>();

    const total = Number(countRow?.count ?? 0);

    const { results } = await db
      .prepare(
        `SELECT i.id, i.album_id, a.name AS album_name, i.caption,
                i.taken_at, i.has_exif_date, i.uploaded_at, i.width, i.height
         FROM images i
         LEFT JOIN albums a ON a.id = i.album_id
         ${whereSql}
         ORDER BY i.taken_at DESC, i.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset)
      .all<ImageDbRow>();

    const rows = results ?? [];
    const tagsByImage = await fetchTagsByImageIds(
      db,
      rows.map((r) => r.id)
    );

    const items: ImageItem[] = rows.map((row) => {
      const urls = buildMediaUrls(row.id);
      return {
        id: row.id,
        albumId: row.album_id ?? null,
        albumName: row.album_name ?? null,
        caption: row.caption ?? '',
        tags: tagsByImage.get(row.id) ?? [],
        takenAt: Number(row.taken_at),
        hasExifDate: Number(row.has_exif_date) === 1,
        uploadedAt: Number(row.uploaded_at),
        width: Number(row.width),
        height: Number(row.height),
        thumbUrl: urls.thumbUrl,
        displayUrl: urls.displayUrl,
      };
    });

    const body: ImagesRangeResponse = {
      total,
      offset,
      limit,
      items,
    };
    return c.json(body);
  });

  images.get('/api/images/ids', async (c) => {
    const db = c.env.DB;
    const albumId = c.req.query('albumId')?.trim() || undefined;
    const tag = c.req.query('tag')?.trim() || undefined;

    const { whereSql, binds } = buildFilterWhere({ albumId, tag });

    const { results } = await db
      .prepare(
        `SELECT i.id, i.caption, i.taken_at, i.width, i.height
         FROM images i
         ${whereSql}
         ORDER BY i.taken_at DESC, i.id DESC`
      )
      .bind(...binds)
      .all<FrameDbRow>();

    const items: FrameItem[] = (results ?? []).map((row) => ({
      id: row.id,
      caption: row.caption ?? '',
      takenAt: Number(row.taken_at),
      width: Number(row.width),
      height: Number(row.height),
      displayUrl: `/api/media/display/${row.id}`,
    }));

    const body: FrameIdsResponse = {
      total: items.length,
      items,
    };
    return c.json(body);
  });

  return images;
}
