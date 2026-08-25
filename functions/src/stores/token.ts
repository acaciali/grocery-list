/**
 * Kroger OAuth2 helpers.
 *
 * Client-credentials tokens (product + location data) live ~30 minutes. We cache in
 * module memory with an early-expiry margin AND retry once on 401 -- a warm Cloud
 * Function instance can outlive any token, and a cache without expiry handling shows up
 * as intermittent 401s that look like random failures.
 *
 * User tokens (cart writes) are a separate authorization-code flow; the exchange and
 * refresh helpers live here too, but storage belongs to the caller (Firestore
 * users/{uid}/private/kroger, Admin SDK only).
 */

const DEFAULT_BASE = 'https://api.kroger.com';

export function krogerBaseUrl(): string {
  return process.env.KROGER_BASE_URL ?? DEFAULT_BASE;
}

function clientCredentials(): { id: string; secret: string } {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'KROGER_CLIENT_ID / KROGER_CLIENT_SECRET are not set. Put them in functions/.env ' +
        '(gitignored) for the emulator, or `firebase functions:secrets:set` for deploys.',
    );
  }
  return { id, secret };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const { id, secret } = clientCredentials();
  const res = await fetch(`${krogerBaseUrl()}/v1/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Kroger token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

let cached: { token: string; expiresAtMs: number } | null = null;

/** Sixty seconds of margin so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export async function clientToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAtMs) return cached.token;
  const t = await requestToken(
    new URLSearchParams({ grant_type: 'client_credentials', scope: 'product.compact' }),
  );
  cached = { token: t.access_token, expiresAtMs: Date.now() + t.expires_in * 1000 - EXPIRY_MARGIN_MS };
  return t.access_token;
}

/** Drop the cached token (called after a 401) so the next clientToken() fetches fresh. */
export function invalidateClientToken(): void {
  cached = null;
}

export interface UserTokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

function toUserTokens(t: TokenResponse): UserTokens {
  if (!t.refresh_token) throw new Error('Kroger token response missing refresh_token');
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAtMs: Date.now() + t.expires_in * 1000 - EXPIRY_MARGIN_MS,
  };
}

/** Authorization-code exchange, the second leg of the user OAuth redirect flow. */
export async function exchangeAuthCode(code: string, redirectUri: string): Promise<UserTokens> {
  return toUserTokens(
    await requestToken(
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    ),
  );
}

export async function refreshUserToken(refreshToken: string): Promise<UserTokens> {
  return toUserTokens(
    await requestToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })),
  );
}
