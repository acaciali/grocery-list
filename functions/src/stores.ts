import { onRequest, type Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import type { StoreAdapter } from './stores/adapter.js';
import { KrogerStore } from './stores/kroger.js';
import { MockStore } from './stores/mock.js';

/**
 * MockStore unless real credentials are present, so a fresh clone demos with zero setup
 * and CI never talks to Kroger. STORE_ADAPTER=mock forces the mock even with creds --
 * useful when Kroger is down or rate-limited mid-demo.
 */
function adapter(): StoreAdapter {
  const forced = process.env.STORE_ADAPTER;
  if (forced === 'mock') return new MockStore();
  if (forced === 'kroger' || process.env.KROGER_CLIENT_ID) return new KrogerStore();
  return new MockStore();
}

function fail(res: Response, err: unknown): void {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  // Config problems are the caller's to fix; upstream failures are 502.
  res.status(msg.includes('not set') ? 500 : 502).json({ error: msg });
}

const requireParam = (req: Request, res: Response, name: string): string | null => {
  const v = req.query[name];
  if (typeof v === 'string' && v.length > 0) return v;
  res.status(400).json({ error: `missing required query param: ${name}` });
  return null;
};

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
    res.json({ products: await adapter().searchProducts(q.slice(0, 128), locationId, 10) });
  } catch (err) {
    fail(res, err);
  }
});
