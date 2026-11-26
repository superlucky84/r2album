export const CHUNK_SIZE = 40;
export const MAX_PAGE_LIMIT = 500;
export const ADMIN_PAGE_SIZE_OPTIONS = [40, 100, 200, 500] as const;

export const DISPLAY_MAX_DIMENSION = 2048;
export const DISPLAY_WEBP_QUALITY = 0.82;
export const DISPLAY_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const THUMB_MAX_DIMENSION = 480;
export const THUMB_WEBP_QUALITY = 0.75;
export const THUMB_MAX_BYTES = 512 * 1024; // 512 KB

export const R2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB
export const R2_STORAGE_HARD_CAP_BYTES = 9_500_000_000; // 9.5 GB decimal safety cap (< 10 GB free tier)
export const UPLOAD_CONCURRENCY = 3;
export const BULK_DELETE_MAX = 500;

export const CAPTION_MAX_LENGTH = 500;
export const TAG_MAX_COUNT = 20;
export const TAG_MAX_LENGTH = 30;
export const ALBUM_NAME_MAX_LENGTH = 60;
export const MAX_PENDING_USERS = 100;
