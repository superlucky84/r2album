import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { WorkerBindings } from '../env';

export const TEST_SESSION_SECRET = 'r2album-test-session-secret-key-32bytes!!';

export function createTestWebpBytes(extraPayload = 'test'): Uint8Array {
  const payloadBytes = new TextEncoder().encode(extraPayload);
  const size = 12 + payloadBytes.length;
  const buf = new Uint8Array(size);
  // RIFF
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46;
  // file size - 8 (little endian)
  const riffSize = size - 8;
  buf[4] = riffSize & 0xff;
  buf[5] = (riffSize >> 8) & 0xff;
  buf[6] = (riffSize >> 16) & 0xff;
  buf[7] = (riffSize >> 24) & 0xff;
  // WEBP
  buf[8] = 0x57;
  buf[9] = 0x45;
  buf[10] = 0x42;
  buf[11] = 0x50;
  buf.set(payloadBytes, 12);
  return buf;
}

export function createSqliteD1(options: { failOnInsertImages?: boolean } = {}): {
  db: D1Database;
  sqlite: DatabaseSync;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const rootDir = resolve(import.meta.dirname, '../../..');
  const m1 = readFileSync(resolve(rootDir, 'migrations/0001_init.sql'), 'utf8');
  const m2 = readFileSync(resolve(rootDir, 'migrations/0002_user_approval.sql'), 'utf8');
  sqlite.exec(m1);
  sqlite.exec(m2);

  type SqlParam = string | number | bigint | Uint8Array | null;

  const toSqlParams = (args: unknown[]): SqlParam[] =>
    args.map((arg) => {
      if (arg === undefined || arg === null) return null;
      if (
        typeof arg === 'string' ||
        typeof arg === 'number' ||
        typeof arg === 'bigint' ||
        arg instanceof Uint8Array
      ) {
        return arg;
      }
      return String(arg);
    });

  const db = {
    prepare(query: string) {
      const makeRunner = (args: unknown[]) => ({
        async first<T = unknown>() {
          const stmt = sqlite.prepare(query);
          const row = stmt.get(...toSqlParams(args));
          return (row ?? null) as T | null;
        },
        async all<T = unknown>() {
          const stmt = sqlite.prepare(query);
          const rows = stmt.all(...toSqlParams(args));
          return { results: rows as T[], success: true };
        },
        async run() {
          if (options.failOnInsertImages && query.includes('INSERT INTO images')) {
            throw new Error('Simulated D1 insert failure');
          }
          const stmt = sqlite.prepare(query);
          const info = stmt.run(...toSqlParams(args));
          return {
            success: true,
            meta: { changes: Number(info.changes ?? 0) },
          };
        },
      });

      return {
        ...makeRunner([]),
        bind(...args: unknown[]) {
          return makeRunner(args);
        },
      };
    },
  };

  return { db: db as unknown as D1Database, sqlite };
}

interface StoredR2Object {
  bytes: Uint8Array;
  contentType: string;
  etag: string;
}

export function createMemoryR2(): {
  bucket: R2Bucket;
  store: Map<string, StoredR2Object>;
} {
  const store = new Map<string, StoredR2Object>();
  let etagCounter = 1;

  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      opts?: { httpMetadata?: { contentType?: string } }
    ) {
      const bytes =
        value instanceof Uint8Array
          ? new Uint8Array(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new TextEncoder().encode(value);
      const etag = `etag-${etagCounter++}`;
      store.set(key, {
        bytes,
        contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream',
        etag,
      });
      return { key, size: bytes.byteLength, etag, httpEtag: `"${etag}"` };
    },
    async get(key: string) {
      const item = store.get(key);
      if (!item) return null;
      return {
        key,
        size: item.bytes.byteLength,
        etag: item.etag,
        httpEtag: `"${item.etag}"`,
        httpMetadata: { contentType: item.contentType },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(item.bytes);
            controller.close();
          },
        }),
      };
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        store.delete(key);
      }
    },
  };

  return { bucket: bucket as unknown as R2Bucket, store };
}

export function createTestEnv(options: { failOnInsertImages?: boolean } = {}) {
  const { db, sqlite } = createSqliteD1(options);
  const { bucket, store } = createMemoryR2();

  const env: WorkerBindings = {
    DB: db,
    MEDIA_BUCKET: bucket,
    APP_ORIGIN: 'http://localhost:5173',
    BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    SESSION_SECRET: TEST_SESSION_SECRET,
  };

  return { env, sqlite, r2Store: store };
}
