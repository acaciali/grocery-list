import { firebaseConfig } from '@grocery/shared';
import type { StoreLocation, StoreProduct } from '@grocery/shared';

/**
 * In dev this points at the Functions emulator regardless of VITE_USE_EMULATORS --
 * unlike Firestore, there is no prod fallback for our own endpoints until first deploy.
 */
const BASE =
  import.meta.env.VITE_FUNCTIONS_BASE ??
  (import.meta.env.DEV
    ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/us-central1`
    : `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`);

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function findStores(zip: string, signal?: AbortSignal): Promise<StoreLocation[]> {
  return getJson<{ stores: StoreLocation[] }>(
    `/findStores?zip=${encodeURIComponent(zip)}`,
    signal,
  ).then((b) => b.stores);
}

export function searchProducts(
  q: string,
  locationId: string,
  signal?: AbortSignal,
): Promise<StoreProduct[]> {
  return getJson<{ products: StoreProduct[] }>(
    `/searchProducts?q=${encodeURIComponent(q)}&locationId=${encodeURIComponent(locationId)}`,
    signal,
  ).then((b) => b.products);
}
