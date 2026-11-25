import { describe, expect, it } from 'vitest';
import {
  buildClearCookie,
  isSecureRequest,
  parseCookies,
  serializeCookie,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
} from '../auth/session';

const TEST_SECRET = 'super-secret-signing-key-at-least-32-chars!';

describe('Worker session token & cookies', () => {
  it('signs and verifies a valid session token', async () => {
    const now = 1_700_000_000;
    const token = await signSessionToken(
      { email: 'admin@example.com', name: 'Admin', role: 'admin' },
      TEST_SECRET,
      3600,
      now
    );

    const verified = await verifySessionToken(token, TEST_SECRET, now + 100);
    expect(verified).toEqual({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      exp: now + 3600,
    });
  });

  it('rejects expired session tokens', async () => {
    const now = 1_700_000_000;
    const token = await signSessionToken(
      { email: 'viewer@example.com', name: 'Viewer', role: 'viewer' },
      TEST_SECRET,
      60,
      now
    );

    expect(await verifySessionToken(token, TEST_SECRET, now + 60)).toBeNull();
    expect(await verifySessionToken(token, TEST_SECRET, now + 120)).toBeNull();
  });

  it('rejects tampered payload or wrong secret', async () => {
    const now = 1_700_000_000;
    const token = await signSessionToken(
      { email: 'viewer@example.com', name: 'Viewer', role: 'viewer' },
      TEST_SECRET,
      3600,
      now
    );

    const [payloadPart, sigPart] = token.split('.');
    const tamperedPayload = btoa(
      JSON.stringify({
        email: 'viewer@example.com',
        name: 'Viewer',
        role: 'admin',
        exp: now + 3600,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verifySessionToken(`${tamperedPayload}.${sigPart}`, TEST_SECRET, now)).toBeNull();
    expect(await verifySessionToken(`${payloadPart}.invalidSig`, TEST_SECRET, now)).toBeNull();
    expect(await verifySessionToken(token, 'another-secret-key', now)).toBeNull();
    expect(await verifySessionToken('not-a-valid-token', TEST_SECRET, now)).toBeNull();
  });

  it('parses and serializes HttpOnly cookies cleanly', () => {
    const header = serializeCookie(SESSION_COOKIE_NAME, 'abc.123', {
      maxAge: 3600,
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
    });
    expect(header).toContain('r2album_session=abc.123');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=3600');

    const cleared = buildClearCookie(SESSION_COOKIE_NAME, false);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).not.toContain('Secure');

    const parsed = parseCookies('foo=bar; r2album_session=abc.123; other=hello%20world');
    expect(parsed).toEqual({
      foo: 'bar',
      r2album_session: 'abc.123',
      other: 'hello world',
    });

    expect(isSecureRequest('https://album.example.com', 'http://localhost:8787')).toBe(true);
    expect(isSecureRequest('http://localhost:5173', 'http://localhost:8787')).toBe(false);
  });
});
