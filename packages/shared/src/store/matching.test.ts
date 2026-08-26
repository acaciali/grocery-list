import { describe, expect, it } from 'vitest';
import { MockStore } from './mock.js';
import { toMatch } from './matching.js';

/**
 * B1's fixture table, verified against the real search -> rank -> toMatch path.
 *
 * This is the whole resolver except the Firestore cache in front of it, which is exactly
 * the split that matters: the cache is a latency optimisation that degrades to a miss, so
 * every decision about what state an item lands in is made here. That makes these
 * assertions runnable with no emulator, no JRE, and no credentials.
 */
const LOCATION = 'mock-01400376';

async function resolve(term: string) {
  const products = await new MockStore().searchProducts(term, LOCATION, 10);
  return toMatch(term, products, LOCATION);
}

describe('resolver fixtures', () => {
  it('milk -> matched, with a product and a location', async () => {
    const match = await resolve('milk');
    expect(match.status).toBe('matched');
    expect(match.product?.upc).toBe('0001111041700');
    expect(match.locationId).toBe(LOCATION);
    expect(match.chosenBy).toBe('auto');
    // Every matched item is cart-ready or the cart send will reject it.
    expect(match.product?.upc).toBeTruthy();
  });

  it('bread -> ambiguous, with candidates and no auto-pick', async () => {
    const match = await resolve('bread');
    expect(match.status).toBe('ambiguous');
    expect(match.product).toBeNull();
    expect(match.candidates).toHaveLength(5);
  });

  /** Found the right product; the store is out. Different problem, different fix than
   *  no_match -- this one has a substitute action. */
  it('eggs -> unavailable, still carrying the product', async () => {
    const match = await resolve('eggs');
    expect(match.status).toBe('unavailable');
    expect(match.product?.stockLevel).toBe('TEMPORARILY_OUT_OF_STOCK');
  });

  it('birthday card -> no_match, with nothing to offer', async () => {
    const match = await resolve('birthday card');
    expect(match.status).toBe('no_match');
    expect(match.product).toBeNull();
    expect(match.candidates).toEqual([]);
  });

  /** The scorer must not punish a store for being specific about brand and size. */
  it('prefers a branded product that covers every word typed', async () => {
    const match = await resolve('2% milk');
    expect(match.status).toBe('matched');
    expect(match.product?.name).toContain('2%');
  });
});

describe('MockStore.addToCart', () => {
  it('accepts a line with a upc', async () => {
    await expect(
      new MockStore().addToCart('token', [{ upc: '0001111041700', quantity: 1 }], 'PICKUP'),
    ).resolves.toBeUndefined();
  });

  it('refuses a line with no upc, the way Kroger would', async () => {
    await expect(
      new MockStore().addToCart('token', [{ upc: '', quantity: 1 }], 'PICKUP'),
    ).rejects.toThrow(/missing upc/);
  });
});
