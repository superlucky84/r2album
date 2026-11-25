import type { AuthUser, UserRole } from '../../shared/types';

export const SESSION_COOKIE_NAME = 'r2album_session';
export const OAUTH_STATE_COOKIE_NAME = 'r2album_oauth_state';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

export interface SessionPayload {
  email: string;
  name: string;
  role: UserRole;
  exp: number; // epoch seconds
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  exp: number; // epoch seconds
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  try {
    const binary = atob(padded + '='.repeat(padLen));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signPayload<T extends object>(payload: T, secret: string): Promise<string> {
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, textEncoder.encode(encodedPayload));
  const encodedSig = toBase64Url(new Uint8Array(sigBuf));
  return `${encodedPayload}.${encodedSig}`;
}

export async function verifyPayload<T extends { exp: number }>(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSig] = parts;
  if (!encodedPayload || !encodedSig) return null;

  const sigBytes = fromBase64Url(encodedSig);
  const payloadBytes = fromBase64Url(encodedPayload);
  if (!sigBytes || !payloadBytes) return null;

  try {
    const key = await importHmacKey(secret);
    const sigBuffer = new Uint8Array(sigBytes).buffer;
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuffer,
      textEncoder.encode(encodedPayload)
    );
    if (!valid) return null;

    const parsed = JSON.parse(textDecoder.decode(payloadBytes)) as T;
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowSeconds) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function signSessionToken(
  user: AuthUser,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload: SessionPayload = {
    email: user.email,
    name: user.name,
    role: user.role,
    exp: nowSeconds + ttlSeconds,
  };
  return signPayload(payload, secret);
}

export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds?: number
): Promise<SessionPayload | null> {
  const payload = await verifyPayload<SessionPayload>(token, secret, nowSeconds);
  if (!payload) return null;
  if (
    typeof payload.email !== 'string' ||
    typeof payload.name !== 'string' ||
    (payload.role !== 'admin' && payload.role !== 'viewer')
  ) {
    return null;
  }
  return payload;
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
  path?: string;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  });
}

export function isSecureRequest(appOrigin: string | undefined, requestUrl: string): boolean {
  const target = appOrigin || requestUrl;
  try {
    return new URL(target).protocol === 'https:';
  } catch {
    return true;
  }
}
