import type { StoreLocation, StoreProduct } from '../types.js';
import type { CartLine, Modality, StoreAdapter } from './adapter.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const product = (p: Partial<StoreProduct> & Pick<StoreProduct, 'productId' | 'upc' | 'name'>): StoreProduct => ({
  brand: null,
  size: null,
  imageUrl: null,
  price: null,
  promoPrice: null,
  stockLevel: 'HIGH',
  category: null,
  ...p,
});

/**
 * Fixtures keyed by what they exercise, one per MatchStatus the UI has to render:
 *
 *   "milk"     -> one confident match           (matched)
 *   "bread"    -> five plausible candidates     (ambiguous)
 *   "eggs"     -> right product, out of stock   (unavailable)
 *   "birthday" -> zero results                  (no_match / not_sold)
 *   "slow ..." -> 2.5s delay                    (resolving states, spinners)
 *
 * Anything else returns two generic results so free typing still demos.
 */
const FIXTURES: Array<{ test: RegExp; results: StoreProduct[] }> = [
  {
    test: /milk/,
    results: [
      product({
        productId: 'mock-milk-1', upc: '0001111041700',
        name: 'Kroger® 2% Reduced Fat Milk', brand: 'Kroger', size: '1 gal',
        price: 3.49, category: 'dairy',
      }),
    ],
  },
  {
    test: /bread/,
    results: [
      product({ productId: 'mock-bread-1', upc: '0001111000101', name: 'Kroger® White Bread', brand: 'Kroger', size: '20 oz', price: 1.79, category: 'bakery' }),
      product({ productId: 'mock-bread-2', upc: '0001111000102', name: "Dave's Killer Bread® 21 Whole Grains", brand: "Dave's Killer Bread", size: '27 oz', price: 6.49, category: 'bakery' }),
      product({ productId: 'mock-bread-3', upc: '0001111000103', name: 'Kroger® Wheat Sandwich Bread', brand: 'Kroger', size: '20 oz', price: 1.99, category: 'bakery' }),
      product({ productId: 'mock-bread-4', upc: '0001111000104', name: 'Sara Lee® Artesano Bakery Bread', brand: 'Sara Lee', size: '20 oz', price: 3.99, promoPrice: 2.99, category: 'bakery' }),
      product({ productId: 'mock-bread-5', upc: '0001111000105', name: 'Simple Truth Organic™ Sourdough', brand: 'Simple Truth', size: '24 oz', price: 4.99, category: 'bakery' }),
    ],
  },
  {
    test: /egg/,
    results: [
      product({
        productId: 'mock-eggs-1', upc: '0001111060903',
        name: 'Kroger® Grade A Large Eggs', brand: 'Kroger', size: '12 ct',
        price: 2.99, stockLevel: 'TEMPORARILY_OUT_OF_STOCK', category: 'dairy',
      }),
    ],
  },
  { test: /birthday|card|gift/, results: [] },
];

export class MockStore implements StoreAdapter {
  async findStores(zip: string): Promise<StoreLocation[]> {
    await sleep(300);
    return [
      { locationId: 'mock-01400376', name: `Kroger — Main St (${zip})`, address: `123 Main St, ${zip}`, chain: 'KROGER' },
      { locationId: 'mock-01400413', name: `Kroger Marketplace — River Rd (${zip})`, address: `456 River Rd, ${zip}`, chain: 'KROGER' },
      { locationId: 'mock-70100070', name: `Smith's — Center St (${zip})`, address: `789 Center St, ${zip}`, chain: 'SMITHS' },
    ];
  }

  async searchProducts(term: string, _locationId: string, limit = 10): Promise<StoreProduct[]> {
    const q = term.toLowerCase();
    await sleep(q.startsWith('slow') ? 2500 : 250);
    const hit = FIXTURES.find((f) => f.test.test(q));
    if (hit) return hit.results.slice(0, limit);
    return [
      product({ productId: `mock-${q}-1`, upc: '0009999000001', name: `Kroger® ${term}`, brand: 'Kroger', size: '1 ea', price: 4.99 }),
      product({ productId: `mock-${q}-2`, upc: '0009999000002', name: `Simple Truth Organic™ ${term}`, brand: 'Simple Truth', size: '1 ea', price: 6.99 }),
    ].slice(0, limit);
  }

  async addToCart(_token: string, lines: CartLine[], _modality: Modality): Promise<void> {
    await sleep(400);
    if (lines.some((l) => !l.upc)) throw new Error('MockStore: line missing upc');
  }
}
