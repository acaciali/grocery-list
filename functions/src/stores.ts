import { onRequest } from 'firebase-functions/v2/https';
import type { StoreMatch, StoreProduct } from '@grocery/shared/types';
import { adapter } from './stores/select.js';
import { readProductPref, readSearchCache, writeProductPref, writeSearchCache } from './stores/cache.js';
import { toMatch } from './stores/matching.js';
import { fail, requireParam, requirePost } from './http.js';

export const findStores = onRequest({ cors: true }, async (req, res) => {
  const zip = requireParam(req, res, 'zip');
  if (!zip) return;
  if (!/^\d{5}$/.test(zip)) {
    res.status(400).json({ error: 'zip must be 5 digits' });
    return;
  }
  try {
    res.json({ stores: await adapter().findStores(zip) });
  } catch (err) {
    fail(res, err);
  }
});

export const searchProducts = onRequest({ cors: true }, async (req, res) => {
  const q = requireParam(req, res, 'q');
  if (!q) return;
  const locationId = requireParam(req, res, 'locationId');
  if (!locationId) return;
  try {
    res.json({ products: await cachedSearch(q.slice(0, 128), locationId) });
  } catch (err) {
    fail(res, err);
  }
});

/** Cache-aware product search: memory of your own picks first, then the shared cache. */
async function cachedSearch(term: string, locationId: string): Promise<StoreProduct[]> {
  const cached = await readSearchCache(locationId, term);
  if (cached) return cached;
  const fresh = await adapter().searchProducts(term, locationId, 10);
  await writeSearchCache(locationId, term, fresh);
  return fresh;
}

interface ResolveRequestItem {
  id: string;
  name: string;
}

/**
 * Batch-resolve list items to store products.
 *
 * This exists because type-ahead only covers items typed into the grocery input. Items
 * arriving from Recipe (I1) and Inventory (I2) are written by another team and never
 * touch that input, so they land 'unresolved' and need resolving after the fact.
 */
export const resolveItems = onRequest({ cors: true }, async (req, res) => {
  if (!requirePost(req, res)) return;
  const body = req.body as { locationId?: string; uid?: string; items?: ResolveRequestItem[] };
  const { locationId, uid } = body;
  const items = body.items ?? [];

  if (!locationId) {
    res.status(400).json({ error: 'locationId is required' });
    return;
  }
  if (items.length === 0) {
    res.json({ matches: {} });
    return;
  }
  if (items.length > 50) {
    res.status(400).json({ error: 'at most 50 items per call' });
    return;
  }

  try {
    const entries = await Promise.all(
      items.map(async (item): Promise<[string, StoreMatch]> => {
        // Your own previous pick for this exact text wins over any fresh search.
        const remembered = uid ? await readProductPref(uid, item.name) : null;
        if (remembered) {
          return [
            item.id,
            {
              status: remembered.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? 'unavailable' : 'matched',
              locationId,
              product: remembered,
              confidence: 1,
              chosenBy: 'memory',
              cartQuantity: 1,
            },
          ];
        }
        const products = await cachedSearch(item.name, locationId);
        return [item.id, toMatch(item.name, products, locationId)];
      }),
    );
    res.json({ matches: Object.fromEntries(entries) });
  } catch (err) {
    fail(res, err);
  }
});

/** Remember a user's correction so the same text resolves straight to it next time. */
export const rememberChoice = onRequest({ cors: true }, async (req, res) => {
  if (!requirePost(req, res)) return;
  const { uid, term, product } = req.body as {
    uid?: string;
    term?: string;
    product?: StoreProduct;
  };
  if (!uid || !term || !product?.productId) {
    res.status(400).json({ error: 'uid, term and product are required' });
    return;
  }
  try {
    await writeProductPref(uid, term, product);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
