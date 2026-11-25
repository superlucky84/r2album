import { toBase64Url } from './session';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const textEncoder = new TextEncoder();

export interface GoogleUserInfo {
  email: string;
  emailVerified: boolean;
  name: string;
}

export function generateRandomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function computeCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(codeVerifier));
  return toBase64Url(new Uint8Array(digest));
}

export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.codeVerifier,
  });

  const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed with status ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: unknown };
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Google token response missing access_token');
  }
  return { accessToken: data.access_token };
}

export async function fetchGoogleUserInfo(params: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleUserInfo> {
  const fetchFn = params.fetchImpl ?? fetch;
  const res = await fetchFn(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Google userinfo request failed with status ${res.status}`);
  }

  const data = (await res.json()) as {
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };

  if (typeof data.email !== 'string' || !data.email) {
    throw new Error('Google userinfo missing email');
  }

  return {
    email: data.email.trim().toLowerCase(),
    emailVerified: data.email_verified === true,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : data.email,
  };
}
