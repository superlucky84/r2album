import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

export interface WorkerBindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS?: Fetcher;
  APP_ORIGIN: string;
  BOOTSTRAP_ADMIN_EMAIL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  MAX_STORAGE_BYTES?: string;
}
