/**
 * The store, answered by our Cloud Functions.
 *
 * This is the only path that can reach live Kroger: the client-credentials token needs a
 * secret that must never be in browser JavaScript, and Kroger's API sends no CORS headers
 * either way. Both problems are the function's to hold.
 *
 * Deploying functions requires the Blaze plan, so this implementation is opt-in --
 * see `api.ts` for how the mode is chosen.
 */
import { firebaseConfig } from '@grocery/shared';
import type { StoreLocation, StoreMatch, StoreProduct } from '@grocery/shared';
import {
  ApiError,
  type ResolveInput,
  type SendInput,
  type SendResult,
  type StoreApi,
} from './storeApi';

/**
 * In dev this points at the Functions emulator: unlike Firestore, there is no prod
 * fallback for our own endpoints until first deploy.
 */
const BASE =
  import.meta.env.VITE_FUNCTIONS_BASE ??
  (import.meta.env.DEV
    ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/us-central1`
    : `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `${path} failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export const functionsStore: StoreApi = {
  findStores(zip, signal) {
    return request<{ stores: StoreLocation[] }>(`/findStores?zip=${encodeURIComponent(zip)}`, {
      signal,
    }).then((b) => b.stores);
  },

  searchProducts(q, locationId, signal) {
    return request<{ products: StoreProduct[] }>(
      `/searchProducts?q=${encodeURIComponent(q)}&locationId=${encodeURIComponent(locationId)}`,
      { signal },
    ).then((b) => b.products);
  },

  resolveItems(locationId: string, items: ResolveInput[], uid: string | null, signal?: AbortSignal) {
    return post<{ matches: Record<string, StoreMatch> }>(
      '/resolveItems',
      { locationId, uid: uid ?? undefined, items },
      signal,
    ).then((b) => b.matches);
  },

  /**
   * Teach the resolver what this user meant by a piece of text. Best-effort: a failure
   * costs a better guess next time, never the choice the user just made.
   */
  rememberChoice(uid, term, product) {
    return post<{ ok: true }>('/rememberChoice', { uid, term, product }).then(() => undefined);
  },

  /** Whether this user has live Kroger authorization. Cart writes need it; search does not. */
  krogerLinked(uid, signal) {
    return request<{ linked: boolean }>(`/krogerStatus?uid=${encodeURIComponent(uid)}`, {
      signal,
    }).then((b) => b.linked);
  },

  /**
   * The URL to send the browser to for Kroger's consent screen. `redirect` is where the
   * callback returns the user afterwards, and the server checks it against an origin
   * allowlist -- an unlisted origin is a 400, not a silent redirect somewhere else.
   */
  krogerAuthUrl(uid, redirect) {
    return request<{ url: string }>(
      `/krogerAuthUrl?uid=${encodeURIComponent(uid)}&redirect=${encodeURIComponent(redirect)}`,
    ).then((b) => b.url);
  },

  /**
   * Push lines into the store cart. Fire-and-forget by nature: Kroger's Public API cannot
   * read a cart back, so `results` is the only account of what happened and a re-send
   * duplicates rather than reconciling.
   */
  sendToCart(input: SendInput) {
    return post<SendResult>('/addToCart', input);
  },
};
