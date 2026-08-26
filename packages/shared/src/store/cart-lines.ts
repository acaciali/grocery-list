/** Pure validation for cart send requests, kept testable without the Functions runtime. */

export interface CartRequestLine {
  itemId: string;
  upc: string;
  quantity: number;
}

export interface LineResult {
  itemId: string;
  ok: boolean;
  error?: string;
}

/** A list longer than this is a bug or an accident, not a grocery run. */
export const MAX_LINES = 100;

export function validateLines(raw: unknown): CartRequestLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('lines must be a non-empty array');
  if (raw.length > MAX_LINES) throw new Error(`at most ${MAX_LINES} lines per send`);
  return raw.map((l, i) => {
    const line = l as Partial<CartRequestLine> | null;
    if (!line?.itemId) throw new Error(`lines[${i}] is missing itemId`);
    // No UPC means the item was never matched to a real product. The caller should have
    // filtered it out and told the user why, rather than sending a line that cannot work.
    if (!line.upc) throw new Error(`lines[${i}] (${line.itemId}) is missing upc`);
    const quantity = Math.trunc(Number(line.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new Error(`lines[${i}] (${line.itemId}) has an invalid quantity`);
    }
    return { itemId: line.itemId, upc: line.upc, quantity };
  });
}
