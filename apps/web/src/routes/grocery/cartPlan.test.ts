import { describe, expect, it } from 'vitest';
import type { StoreMatch, StoreProduct } from '@grocery/shared';
import { MAX_CART_LINES } from './api';
import { describeResult, planSend, planTotal } from './cartPlan';
import type { Row } from './data';

const STORE_A = 'loc-a';
const STORE_B = 'loc-b';

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'r1',
    name: 'milk',
    checked: false,
    createdAt: null as unknown as Row['createdAt'],
    ...over,
  };
}

const product = (over: Partial<StoreProduct> = {}): StoreProduct => ({
  productId: 'p1',
  upc: '0001111041700',
  name: 'Kroger Whole Milk',
  ...over,
});

const matched = (over: Partial<StoreMatch> = {}): StoreMatch => ({
  status: 'matched',
  locationId: STORE_A,
  product: product(),
  cartQuantity: 1,
  ...over,
});

describe('planSend', () => {
  it('sends a matched row at the connected store', () => {
    const plan = planSend([row({ match: matched() })], STORE_A);
    expect(plan.lines).toEqual([{ itemId: 'r1', upc: '0001111041700', quantity: 1 }]);
    expect(plan.blocked).toEqual([]);
  });

  it('sends cartQuantity packages, not the list quantity', () => {
    // "2 lb chicken" against a 1.5 lb package is 2 packages, not 2 lb.
    const plan = planSend(
      [row({ quantity: 2, unit: 'lb', match: matched({ cartQuantity: 3 }) })],
      STORE_A,
    );
    expect(plan.lines[0]?.quantity).toBe(3);
  });

  it('defaults a missing cartQuantity to one package', () => {
    const plan = planSend([row({ match: matched({ cartQuantity: null }) })], STORE_A);
    expect(plan.lines[0]?.quantity).toBe(1);
  });

  it('skips checked rows -- they are already in the basket', () => {
    const plan = planSend([row({ checked: true, match: matched() })], STORE_A);
    expect(plan.lines).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.alreadySent).toEqual([]);
  });

  it('excludes rows already sent, because a re-send duplicates', () => {
    const plan = planSend([row({ match: matched({ status: 'sent' }) })], STORE_A);
    expect(plan.lines).toEqual([]);
    expect(plan.alreadySent).toHaveLength(1);
  });

  it('blocks rows with no usable product', () => {
    const statuses = ['unresolved', 'resolving', 'ambiguous', 'no_match', 'not_sold'] as const;
    for (const status of statuses) {
      const plan = planSend([row({ match: { status, locationId: STORE_A } })], STORE_A);
      expect(plan.blocked).toEqual([{ row: expect.anything(), reason: 'no_product' }]);
    }
    expect(planSend([row()], STORE_A).blocked[0]?.reason).toBe('no_product');
  });

  it('blocks a match whose product has no UPC -- the cart endpoint needs one', () => {
    const noUpc = matched({ product: product({ upc: '' }) });
    expect(planSend([row({ match: noUpc })], STORE_A).blocked[0]?.reason).toBe('no_product');
  });

  it('blocks out-of-stock rows separately from unmatched ones', () => {
    const plan = planSend([row({ match: matched({ status: 'unavailable' }) })], STORE_A);
    expect(plan.blocked[0]?.reason).toBe('out_of_stock');
  });

  it("blocks another store's match rather than sending its UPC here", () => {
    const plan = planSend([row({ match: matched({ locationId: STORE_B }) })], STORE_A);
    expect(plan.lines).toEqual([]);
    expect(plan.blocked[0]?.reason).toBe('other_store');
  });

  it('caps at the line limit and reports the remainder', () => {
    const many = Array.from({ length: MAX_CART_LINES + 3 }, (_, i) =>
      row({ id: `r${i}`, match: matched() }),
    );
    const plan = planSend(many, STORE_A);
    expect(plan.lines).toHaveLength(MAX_CART_LINES);
    expect(plan.overflow).toBe(3);
  });
});

describe('planTotal', () => {
  it('multiplies price by packages', () => {
    const plan = planSend(
      [row({ match: matched({ cartQuantity: 2, product: product({ price: 3.5 }) }) })],
      STORE_A,
    );
    expect(planTotal(plan)).toBe(7);
  });

  it('prefers a promo price', () => {
    const promo = matched({ product: product({ price: 4, promoPrice: 2.5 }) });
    expect(planTotal(planSend([row({ match: promo })], STORE_A))).toBe(2.5);
  });

  it('gives no total when any line is unpriced, rather than an undercount', () => {
    const plan = planSend(
      [
        row({ id: 'a', match: matched({ product: product({ price: 3 }) }) }),
        row({ id: 'b', match: matched({ product: product({ productId: 'p2' }) }) }),
      ],
      STORE_A,
    );
    expect(planTotal(plan)).toBeNull();
  });

  it('gives no total for an empty plan', () => {
    expect(planTotal(planSend([], STORE_A))).toBeNull();
  });
});

describe('describeResult', () => {
  const rows = [row({ id: 'a', name: 'milk' }), row({ id: 'b', name: 'butter' })];

  it('reports a clean send', () => {
    const results = [{ itemId: 'a', ok: true }, { itemId: 'b', ok: true }];
    expect(describeResult(results, rows)).toBe('Sent 2 items to your cart.');
  });

  it('names the failures, not just the count', () => {
    const results = [{ itemId: 'a', ok: true }, { itemId: 'b', ok: false, error: 'boom' }];
    expect(describeResult(results, rows)).toContain('butter');
    expect(describeResult(results, rows)).toContain('Sent 1 of 2');
  });

  it('says plainly when nothing landed', () => {
    const results = [{ itemId: 'a', ok: false }, { itemId: 'b', ok: false }];
    expect(describeResult(results, rows)).toBe(
      'Nothing went through: milk, butter. Everything is still on your list.',
    );
  });
});
