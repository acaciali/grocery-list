import { describe, expect, it } from 'vitest';
import type { GroceryItem, ItemKey } from '@grocery/shared/types';
import { decide } from './backfill-keys.js';

/** Legacy docs predate the contract: name, checked, createdAt and nothing else. */
const legacy = (over: Partial<GroceryItem> = {}): GroceryItem =>
  ({ name: 'Milk', checked: false, createdAt: null, ...over }) as unknown as GroceryItem;

describe('backfill decide()', () => {
  it('adds a key to a legacy doc', () => {
    const d = decide('doc1', legacy({ name: '2 cups whole milk' }));
    expect(d).toMatchObject({ kind: 'update', plan: { key: 'milk' } });
  });

  it('leaves category unset when there is nothing to base it on', () => {
    const d = decide('doc1', legacy());
    expect(d.kind).toBe('update');
    expect(d.kind === 'update' && d.plan.category).toBeUndefined();
  });

  /** The only category we are willing to write is one the store already told us. */
  it('takes category from an existing store match', () => {
    const d = decide('doc1', legacy({
      match: {
        status: 'matched',
        locationId: 'mock-01400376',
        product: { productId: 'p', upc: '1', name: 'Kroger® Milk', category: 'dairy' },
      },
    }));
    expect(d).toMatchObject({ kind: 'update', plan: { key: 'milk', category: 'dairy' } });
  });

  it('reports a doc that already has both as complete', () => {
    const d = decide('doc1', legacy({ key: 'milk' as ItemKey, category: 'dairy' }));
    expect(d.kind).toBe('complete');
  });

  /** An existing key is load-bearing for cross-app joins. Report, never rewrite.
   *  `a dozen eggs` -> `dozen-egg` vs `eggs` -> `egg` is the real collision in the
   *  gotchas list, so this is the case that actually shows up in the family list. */
  it('reports drift without planning a key change', () => {
    const d = decide('doc1', legacy({ name: 'eggs', key: 'dozen-egg' as ItemKey, category: 'dairy' }));
    expect(d.kind).toBe('complete');
    expect(d.kind !== 'skip' && d.drift).toEqual({ stored: 'dozen-egg', computed: 'egg' });
  });

  it('still fills a missing category on a drifted doc, leaving the key alone', () => {
    const d = decide('doc1', legacy({
      name: 'eggs',
      key: 'dozen-egg' as ItemKey,
      match: {
        status: 'matched',
        locationId: 'mock-01400376',
        product: { productId: 'p', upc: '1', name: 'Kroger® Eggs', category: 'dairy' },
      },
    }));
    expect(d).toMatchObject({ kind: 'update', plan: { category: 'dairy' } });
    expect(d.kind === 'update' && d.plan.key).toBeUndefined();
  });

  /** Nothing to write is not the same as nothing to say: drift is still reported. */
  it('reports complete when a drifted doc has no category source', () => {
    const d = decide('doc1', legacy({ name: 'eggs', key: 'dozen-egg' as ItemKey }));
    expect(d.kind).toBe('complete');
    expect(d.kind !== 'skip' && d.drift).toEqual({ stored: 'dozen-egg', computed: 'egg' });
  });

  it.each([
    ['', 'no name to normalize'],
    ['   ', 'no name to normalize'],
    ['2 cups', 'no identifying words'],
  ])('skips %j rather than guessing', (name, reason) => {
    const d = decide('doc1', legacy({ name }));
    expect(d.kind).toBe('skip');
    expect(d.kind === 'skip' && d.reason).toMatch(reason);
  });
});
