import type { StoreAdapter } from './adapter.js';
import { KrogerStore } from './kroger.js';
import { MockStore } from './mock.js';

/**
 * MockStore unless real credentials are present, so a fresh clone demos with zero setup
 * and CI never talks to Kroger. STORE_ADAPTER=mock forces the mock even with creds --
 * useful when Kroger is down or rate-limited mid-demo.
 */
export function isMock(): boolean {
  const forced = process.env.STORE_ADAPTER;
  if (forced === 'mock') return true;
  if (forced === 'kroger') return false;
  return !process.env.KROGER_CLIENT_ID;
}

export function adapter(): StoreAdapter {
  return isMock() ? new MockStore() : new KrogerStore();
}
