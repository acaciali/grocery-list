import type { StoreProduct } from '@grocery/shared/types';
import { prefDocId, queryKey } from '@grocery/shared/store';
import { db, withDeadline } from '../db.js';

const TTL_MS = 24 * 60 * 60 * 1000;

const docId = (locationId: string, term: string) =>
  `${locationId}__${queryKey(term)}`.replace(/\//g, '_');

interface CachedSearch {
  products: StoreProduct[];
  cachedAtMs: number;
}

/**
 * Shared across every user: all three surfaces produce searches through the same code,
 * so the first person to look up "milk" at a store warms it for everyone. This is what
 * keeps a 20-ingredient recipe import from costing 20 round-trips against a 10k/day cap.
 */
export async function readSearchCache(
  locationId: string,
  term: string,
): Promise<StoreProduct[] | null> {
  try {
    const snap = await withDeadline(
      db().collection('storeProducts').doc(docId(locationId, term)).get(),
      'search cache read',
    );
    const data = snap.data() as CachedSearch | undefined;
    if (!data) return null;
    if (Date.now() - data.cachedAtMs > TTL_MS) return null;
    return data.products;
  } catch (err) {
    // A cache miss and a broken cache should behave identically to the caller.
    console.error('search cache read failed', err);
    return null;
  }
}

export async function writeSearchCache(
  locationId: string,
  term: string,
  products: StoreProduct[],
): Promise<void> {
  try {
    await withDeadline(
      db()
        .collection('storeProducts')
        .doc(docId(locationId, term))
        .set({ products, cachedAtMs: Date.now(), locationId, term: queryKey(term) }),
      'search cache write',
    );
  } catch (err) {
    console.error('search cache write failed', err);
  }
}

/** What THIS user picked the last time they searched this text. */
export async function readProductPref(
  uid: string,
  term: string,
): Promise<StoreProduct | null> {
  try {
    const snap = await withDeadline(
      db()
        .collection('users').doc(uid)
        .collection('productPrefs').doc(prefDocId(term))
        .get(),
      'product pref read',
    );
    return (snap.data()?.product as StoreProduct | undefined) ?? null;
  } catch (err) {
    console.error('product pref read failed', err);
    return null;
  }
}

/**
 * Unlike the reads, this one throws. rememberChoice() is a user action with a visible
 * result -- silently dropping it teaches the user their correction doesn't stick.
 */
export async function writeProductPref(
  uid: string,
  term: string,
  product: StoreProduct,
): Promise<void> {
  await withDeadline(
    db()
      .collection('users').doc(uid)
      .collection('productPrefs').doc(prefDocId(term))
      .set({ product, term: queryKey(term), updatedAtMs: Date.now() }),
    'product pref write',
  );
}
