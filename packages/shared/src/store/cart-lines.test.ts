import { describe, expect, it } from 'vitest';
import { MAX_LINES, validateLines } from './cart-lines.js';

describe('validateLines', () => {
  it('defaults quantity to one package', () => {
    expect(validateLines([{ itemId: 'a', upc: '0001111041700' }])).toEqual([
      { itemId: 'a', upc: '0001111041700', quantity: 1 },
    ]);
  });

  it('keeps an explicit quantity', () => {
    expect(validateLines([{ itemId: 'a', upc: '111', quantity: 3 }])[0]?.quantity).toBe(3);
  });

  /** An unmatched item has no UPC and can never reach the cart -- reject it here, loudly,
   *  rather than sending a line the store will silently drop. */
  it('rejects a line with no upc, naming the item', () => {
    expect(() => validateLines([{ itemId: 'eggs-row', upc: '' }])).toThrow(/eggs-row.*missing upc/);
  });

  it('rejects a line with no itemId', () => {
    expect(() => validateLines([{ upc: '111' }])).toThrow(/missing itemId/);
  });

  it.each([0, -1, Number.NaN, 'abc'])('rejects quantity %j', (q) => {
    expect(() => validateLines([{ itemId: 'a', upc: '111', quantity: q }])).toThrow(
      /invalid quantity/,
    );
  });

  it('rejects an empty send', () => {
    expect(() => validateLines([])).toThrow(/non-empty/);
    expect(() => validateLines(undefined)).toThrow(/non-empty/);
  });

  it('caps the batch size', () => {
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ itemId: `i${i}`, upc: '1' }));
    expect(() => validateLines(many)).toThrow(new RegExp(`at most ${MAX_LINES}`));
  });
});
