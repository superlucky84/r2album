import {
  ALBUM_NAME_MAX_LENGTH,
  CAPTION_MAX_LENGTH,
  TAG_MAX_COUNT,
  TAG_MAX_LENGTH,
} from '../shared/constants';
import { ApiError } from './errors';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;
const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidImageId(id: string): boolean {
  return SAFE_ID_REGEX.test(id);
}

/**
 * Verifies the RIFF....WEBP container magic bytes (first 12 bytes).
 */
export function isValidWebpBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

export function normalizeCaption(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'INVALID_CAPTION', 'Caption must be a string');
  }
  const trimmed = raw.trim();
  if (trimmed.length > CAPTION_MAX_LENGTH) {
    throw new ApiError(
      400,
      'CAPTION_TOO_LONG',
      `Caption must be at most ${CAPTION_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}

export function normalizeTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, 'INVALID_TAGS', 'Tags must be an array of strings');
  }

  const unique = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new ApiError(400, 'INVALID_TAGS', 'Each tag must be a string');
    }
    const normalized = item.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.length > TAG_MAX_LENGTH) {
      throw new ApiError(
        400,
        'TAG_TOO_LONG',
        `Tag "${normalized}" exceeds ${TAG_MAX_LENGTH} characters`
      );
    }
    unique.add(normalized);
  }

  if (unique.size > TAG_MAX_COUNT) {
    throw new ApiError(400, 'TOO_MANY_TAGS', `At most ${TAG_MAX_COUNT} tags are allowed`);
  }

  return Array.from(unique);
}

export function normalizeAlbumName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'INVALID_ALBUM_NAME', 'Album name is required');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ApiError(400, 'INVALID_ALBUM_NAME', 'Album name cannot be empty');
  }
  if (trimmed.length > ALBUM_NAME_MAX_LENGTH) {
    throw new ApiError(
      400,
      'ALBUM_NAME_TOO_LONG',
      `Album name must be at most ${ALBUM_NAME_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'INVALID_EMAIL', 'Email is required');
  }
  const normalized = raw.trim().toLowerCase();
  if (!BASIC_EMAIL_REGEX.test(normalized) || normalized.length > 254) {
    throw new ApiError(400, 'INVALID_EMAIL', 'Invalid email address');
  }
  return normalized;
}
