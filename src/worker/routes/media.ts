import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware';
import { ApiError } from '../errors';
import { isValidImageId } from '../validation';

const MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export function createMediaRoutes() {
  const media = new Hono<AppEnv>();

  media.get('/api/media/:variant/:id', async (c) => {
    const variant = c.req.param('variant');
    const id = c.req.param('id');

    if (variant !== 'thumb' && variant !== 'display') {
      throw new ApiError(400, 'INVALID_VARIANT', 'Media variant must be "thumb" or "display"');
    }
    if (!isValidImageId(id)) {
      throw new ApiError(400, 'INVALID_IMAGE_ID', 'Invalid image ID');
    }

    const key = `${variant}/${id}.webp`;
    const object = await c.env.MEDIA_BUCKET.get(key);
    if (!object) {
      throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media object not found');
    }

    const etag = object.httpEtag || `"${object.etag}"`;
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': MEDIA_CACHE_CONTROL,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/webp');
    headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
    headers.set('ETag', etag);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (typeof object.size === 'number') {
      headers.set('Content-Length', String(object.size));
    }

    return new Response(object.body as unknown as BodyInit, {
      status: 200,
      headers,
    });
  });

  return media;
}
