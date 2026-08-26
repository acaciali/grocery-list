import { firebaseConfig } from '@grocery/shared';
import type { StoreLocation, StoreMatch, StoreProduct } from '@grocery/shared';

/**
 * In dev this points at the Functions emulator regardless of VITE_USE_EMULATORS --
 * unlike Firestore, there is no prod fallback for our own endpoints until first deploy.
 */
const BASE =
  import.meta.env.VITE_FUNCTIONS_BASE ??
  (import.meta.env.DEV
    ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/us-central1`
    : `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`);

/**
 * Carries the HTTP status through, because one status is load-bearing: addToCart answers
 * 401 when the user's Kroger authorization is missing or dead, and that is a "link your
 * account" prompt rather than an error message.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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

export function findStores(zip: string, signal?: AbortSignal): Promise<StoreLocation[]> {
  return request<{ stores: StoreLocation[] }>(`/findStores?zip=${encodeURIComponent(zip)}`, {
    signal,
  }).then((b) => b.stores);
}

export function searchProducts(
  q: string,
  locationId: string,
  signal?: AbortSignal,
): Promise<StoreProduct[]> {
  return request<{ products: StoreProduct[] }>(
    `/searchProducts?q=${encodeURIComponent(q)}&locationId=${encodeURIComponent(locationId)}`,
    { signal },
  ).then((b) => b.products);
}

export interface ResolveInput {
  id: string;
  name: string;
}

/** The server caps a batch at 50; callers must slice before calling. */
export const RESOLVE_BATCH_LIMIT = 50;

export function resolveItems(
  locationId: string,
  items: ResolveInput[],
  uid: string | null,
  signal?: AbortSignal,
): Promise<Record<string, StoreMatch>> {
  return post<{ matches: Record<string, StoreMatch> }>(
    '/resolveItems',
    { locationId, uid: uid ?? undefined, items },
    signal,
  ).then((b) => b.matches);
}

/**
 * Teach the resolver what this user meant by a piece of text. Best-effort: a failure
 * costs a better guess next time, never the choice the user just made.
 */
export function rememberChoice(
  uid: string,
  term: string,
  product: StoreProduct,
): Promise<void> {
  return post<{ ok: true }>('/rememberChoice', { uid, term, product }).then(() => undefined);
}

// --- Cart ------------------------------------------------------------------------------

/** Pickup or delivery. Kroger wants it per cart-add call, not per account. */
export type Modality = 'PICKUP' | 'DELIVERY';

/** Mirrors MAX_LINES in functions/src/cart-lines.ts. Callers must slice before sending. */
export const MAX_CART_LINES = 100;

export interface SendLine {
  itemId: string;
  upc: string;
  quantity: number;
}

export interface SendLineResult {
  itemId: string;
  ok: boolean;
  error?: string;
}

export interface SendResult {
  batchId: string;
  results: SendLineResult[];
}

/** Whether this user has live Kroger authorization. Cart writes need it; search does not. */
export function krogerLinked(uid: string, signal?: AbortSignal): Promise<boolean> {
  return request<{ linked: boolean }>(`/krogerStatus?uid=${encodeURIComponent(uid)}`, {
    signal,
  }).then((b) => b.linked);
}

/**
 * The URL to send the browser to for Kroger's consent screen. `redirect` is where the
 * callback returns the user afterwards, and the server checks it against an origin
 * allowlist -- an unlisted origin is a 400, not a silent redirect somewhere else.
 */
export function krogerAuthUrl(uid: string, redirect: string): Promise<string> {
  return request<{ url: string }>(
    `/krogerAuthUrl?uid=${encodeURIComponent(uid)}&redirect=${encodeURIComponent(redirect)}`,
  ).then((b) => b.url);
}

/**
 * Push lines into the store cart. Fire-and-forget by nature: Kroger's Public API cannot
 * read a cart back, so `results` is the only account of what happened and a re-send
 * duplicates rather than reconciling.
 */
export function sendToCart(input: {
  uid: string;
  locationId: string;
  modality: Modality;
  lines: SendLine[];
}): Promise<SendResult> {
  return post<SendResult>('/addToCart', input);
}
