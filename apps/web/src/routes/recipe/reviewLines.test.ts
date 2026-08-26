/**
 * What the sheet decides before it renders anything: owned vs. missing, gone-off vs. fine,
 * and which of those start ticked.
 */
import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { normalizeKey, type InventoryItem, type Item } from '@grocery/shared';
import { buildLines, groupLines } from './reviewLines';

function ingredient(name: string): Item {
  return { key: normalizeKey(name), name, category: 'other', quantity: 1, unit: null };
}

/** A pantry row `days` from today -- negative for the past. Undefined means "no date". */
function pantryRow(name: string, days?: number): InventoryItem {
  const expiresAt =
    days === undefined
      ? null
      : Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  return {
    key: normalizeKey(name),
    name,
    category: 'other',
    location: 'pantry',
    addedVia: 'manual',
    expiresAt,
    updatedAt: Timestamp.now(),
  };
}

function pantry(...rows: InventoryItem[]): Map<string, InventoryItem> {
  return new Map(rows.map((row) => [row.key, row]));
}

const NO_LIST = new Set<string>();

describe('buildLines', () => {
  it('ticks what you do not own and unticks what you do', () => {
    const lines = buildLines(
      [ingredient('olive oil'), ingredient('black beans')],
      pantry(pantryRow('Olive oil')),
      NO_LIST,
    );
    expect(lines.map((l) => ({ name: l.item.name, inPantry: l.inPantry, checked: l.checked })))
      .toEqual([
        { name: 'olive oil', inPantry: true, checked: false },
        { name: 'black beans', inPantry: false, checked: true },
      ]);
  });

  it('leaves an EXPIRED pantry item unticked -- you still own it', () => {
    const [line] = buildLines([ingredient('olive oil')], pantry(pantryRow('Olive oil', -120)), NO_LIST);
    expect(line).toMatchObject({ inPantry: true, checked: false });
    expect(line?.expiry).toMatchObject({ label: 'Expired', urgent: true });
  });

  it('flags an item expiring within the urgent window', () => {
    const [line] = buildLines([ingredient('milk')], pantry(pantryRow('Milk', 2)), NO_LIST);
    expect(line?.expiry?.urgent).toBe(true);
  });

  it('does not flag a date comfortably in the future, but still reports it', () => {
    const [line] = buildLines([ingredient('flour')], pantry(pantryRow('Flour', 90)), NO_LIST);
    expect(line?.expiry?.urgent).toBe(false);
    expect(line?.expiry?.label).toMatch(/^Expires /);
  });

  it('carries no expiry for a pantry row with no date recorded', () => {
    const [line] = buildLines([ingredient('salt')], pantry(pantryRow('Salt')), NO_LIST);
    expect(line?.expiry).toBeNull();
    expect(line?.inPantry).toBe(true);
  });

  it('ticks everything when the pantry could not be read', () => {
    const lines = buildLines([ingredient('olive oil'), ingredient('milk')], null, NO_LIST);
    expect(lines.every((l) => l.checked)).toBe(true);
    expect(lines.every((l) => !l.inPantry)).toBe(true);
    expect(lines.every((l) => l.expiry === null)).toBe(true);
  });

  it('matches the pantry on the normalized key, not the display name', () => {
    // "2 cups whole milk" and the pantry's "Milk" are the same thing.
    const [line] = buildLines([ingredient('whole milk')], pantry(pantryRow('Milk')), NO_LIST);
    expect(line?.inPantry).toBe(true);
  });

  it('marks an ingredient already on the grocery list', () => {
    const [line] = buildLines([ingredient('onion')], pantry(), new Set([normalizeKey('onions')]));
    expect(line?.onList).toBe(true);
  });
});

describe('groupLines', () => {
  it('puts expired pantry items in review, missing in the middle, fine ones last', () => {
    const lines = buildLines(
      [
        ingredient('black beans'), // missing
        ingredient('olive oil'), // owned, expired
        ingredient('salt'), // owned, no date
        ingredient('milk'), // owned, expiring in 1 day
      ],
      pantry(pantryRow('Olive oil', -30), pantryRow('Salt'), pantryRow('Milk', 1)),
      NO_LIST,
    );

    const { review, missing, owned } = groupLines(lines);
    expect(review.map((l) => l.item.name)).toEqual(['olive oil', 'milk']);
    expect(missing.map((l) => l.item.name)).toEqual(['black beans']);
    expect(owned.map((l) => l.item.name)).toEqual(['salt']);
  });

  it('never lists a line in two groups', () => {
    const lines = buildLines(
      [ingredient('olive oil'), ingredient('flour'), ingredient('black beans')],
      pantry(pantryRow('Olive oil', -1), pantryRow('Flour', 200)),
      NO_LIST,
    );
    const { review, missing, owned } = groupLines(lines);
    const ids = [...review, ...missing, ...owned].map((l) => l.id);
    expect(new Set(ids).size).toBe(lines.length);
  });
});
