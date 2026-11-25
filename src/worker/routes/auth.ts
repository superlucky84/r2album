import { Hono } from 'hono';
import type { AuthErrorCode, AuthStatusCode, MeResponse } from '../../shared/types';
import { ApiError } from '../errors';
import {
  buildGoogleAuthUrl,
  computeCodeChallenge,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  generateRandomToken,
} from '../auth/google';
import {
  authenticateRequest,
  createPendingSignup,
  resolveUserAccess,
  type AppEnv,
} from '../auth/middleware';
import {
  buildClearCookie,
  isSecureRequest,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_TTL_SECONDS,
  type OAuthStatePayload,
  parseCookies,
  serializeCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signPayload,
  signSessionToken,
  verifyPayload,
} from '../auth/session';

export interface AuthRoutesOptions {
  fetchImpl?: typeof fetch;
}

function getAppOrigin(appOrigin: string | undefined, requestUrl: string): string {
  if (appOrigin && appOrigin.trim()) {
    return appOrigin.replace(/\/+$/, '');
  }
  return new URL(requestUrl).origin;
}

function loginErrorUrl(origin: string, code: AuthErrorCode): string {
  return `${origin}/login?error=${encodeURIComponent(code)}`;
}

function loginStatusUrl(origin: string, status: AuthStatusCode): string {
  return `${origin}/login?status=${encodeURIComponent(status)}`;
}

export function createAuthRoutes(options: AuthRoutesOptions = {}) {
  const auth = new Hono<AppEnv>();

  auth.get('/auth/google', async (c) => {
    const clientId = c.env?.GOOGLE_CLIENT_ID;
    const clientSecret = c.env?.GOOGLE_CLIENT_SECRET;
    const sessionSecret = c.env?.SESSION_SECRET;
    if (!clientId || !clientSecret || !sessionSecret) {
      throw new ApiError(
        503,
        'AUTH_MISCONFIGURED',
        'Google OAuth environment secrets are not configured'
      );
    }

    const origin = getAppOrigin(c.env.APP_ORIGIN, c.req.url);
    const redirectUri = `${origin}/auth/google/callback`;
    const secure = isSecureRequest(origin, c.req.url);

    const state = generateRandomToken(24);
    const codeVerifier = generateRandomToken(32);
    const codeChallenge = await computeCodeChallenge(codeVerifier);

    const statePayload: OAuthStatePayload = {
      state,
      codeVerifier,
      exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    };
    const signedState = await signPayload(statePayload, sessionSecret);

    c.header(
      'Set-Cookie',
      serializeCookie(OAUTH_STATE_COOKIE_NAME, signedState, {
        maxAge: OAUTH_STATE_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
        path: '/',
      }),
      { append: true }
    );

    const googleUrl = buildGoogleAuthUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge,
    });
    return c.redirect(googleUrl, 302);
  });

  auth.get('/auth/google/callback', async (c) => {
    const clientId = c.env?.GOOGLE_CLIENT_ID;
    const clientSecret = c.env?.GOOGLE_CLIENT_SECRET;
    const sessionSecret = c.env?.SESSION_SECRET;
    if (!clientId || !clientSecret || !sessionSecret) {
      throw new ApiError(
        503,
        'AUTH_MISCONFIGURED',
        'Google OAuth environment secrets are not configured'
      );
    }

    const origin = getAppOrigin(c.env.APP_ORIGIN, c.req.url);
    const secure = isSecureRequest(origin, c.req.url);

    // Always clear temporary OAuth state cookie on callback
    c.header('Set-Cookie', buildClearCookie(OAUTH_STATE_COOKIE_NAME, secure), { append: true });

    const oauthError = c.req.query('error');
    if (oauthError) {
      return c.redirect(loginErrorUrl(origin, 'oauth_denied'), 302);
    }

    const code = c.req.query('code');
    const state = c.req.query('state');
    const cookies = parseCookies(c.req.header('Cookie'));
    const rawStateCookie = cookies[OAUTH_STATE_COOKIE_NAME];

    if (!code || !state || !rawStateCookie) {
      return c.redirect(loginErrorUrl(origin, 'invalid_state'), 302);
    }

    const statePayload = await verifyPayload<OAuthStatePayload>(rawStateCookie, sessionSecret);
    if (!statePayload || statePayload.state !== state) {
      return c.redirect(loginErrorUrl(origin, 'invalid_state'), 302);
    }

    let userInfo;
    try {
      const redirectUri = `${origin}/auth/google/callback`;
      const { accessToken } = await exchangeGoogleCode({
        code,
        codeVerifier: statePayload.codeVerifier,
        clientId,
        clientSecret,
        redirectUri,
        fetchImpl: options.fetchImpl,
      });
      userInfo = await fetchGoogleUserInfo({
        accessToken,
        fetchImpl: options.fetchImpl,
      });
    } catch (err) {
      console.error('[r2album] Google OAuth callback error:', err);
      return c.redirect(loginErrorUrl(origin, 'oauth_failed'), 302);
    }

    if (!userInfo.emailVerified) {
      return c.redirect(loginErrorUrl(origin, 'unverified_email'), 302);
    }

    const access = await resolveUserAccess(c.env, userInfo.email);
    if (!access) {
      c.header('Set-Cookie', buildClearCookie(SESSION_COOKIE_NAME, secure), { append: true });
      const signupResult = await createPendingSignup(c.env, {
        email: userInfo.email,
        name: userInfo.name,
      });
      if (signupResult === 'pending') {
        return c.redirect(loginStatusUrl(origin, 'pending'), 302);
      }
      return c.redirect(loginErrorUrl(origin, 'signup_closed'), 302);
    }

    if (access.status === 'pending') {
      c.header('Set-Cookie', buildClearCookie(SESSION_COOKIE_NAME, secure), { append: true });
      return c.redirect(loginStatusUrl(origin, 'pending'), 302);
    }

    if (access.status === 'rejected') {
      c.header('Set-Cookie', buildClearCookie(SESSION_COOKIE_NAME, secure), { append: true });
      return c.redirect(loginErrorUrl(origin, 'rejected'), 302);
    }

    const sessionToken = await signSessionToken(
      { email: userInfo.email, name: userInfo.name, role: access.role },
      sessionSecret
    );
    c.header(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
        maxAge: SESSION_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
        path: '/',
      }),
      { append: true }
    );

    return c.redirect(`${origin}/`, 302);
  });

  auth.post('/auth/logout', (c) => {
    const secure = isSecureRequest(c.env?.APP_ORIGIN, c.req.url);
    c.header('Set-Cookie', buildClearCookie(SESSION_COOKIE_NAME, secure), { append: true });
    return c.json({ ok: true });
  });

  auth.get('/api/me', async (c) => {
    const user = await authenticateRequest(c.env, c.req.header('Cookie'));
    if (!user) {
      const cookies = parseCookies(c.req.header('Cookie'));
      if (cookies[SESSION_COOKIE_NAME]) {
        c.header(
          'Set-Cookie',
          buildClearCookie(SESSION_COOKIE_NAME, isSecureRequest(c.env?.APP_ORIGIN, c.req.url)),
          { append: true }
        );
      }
      const body: MeResponse = { authenticated: false };
      return c.json(body);
    }

    const body: MeResponse = {
      authenticated: true,
      user,
    };
    return c.json(body);
  });

  return auth;
}
