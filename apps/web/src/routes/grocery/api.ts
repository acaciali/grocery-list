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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${path} failed (${res.status})`);
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
