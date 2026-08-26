/**
 * The merge arithmetic behind I1. `planAdds` is pure, so all of this runs without
 * Firestore -- which is the point of splitting the planning out of the write.
 */
import { describe, expect, it } from 'vitest';
import { normalizeKey, type Item, type Unit } from '@grocery/shared';
import { planAdds, type ExistingRow } from './addFromRecipe';

function ingredient(name: string, quantity: number | null = null, unit: Unit | null = null): Item {
  return { key: normalizeKey(name), name, category: 'other', quantity, unit };
}

function row(
  id: string,
  name: string,
  extra: Partial<Omit<ExistingRow, 'id' | 'name'>> = {},
): ExistingRow {
  return { id, name, checked: false, key: normalizeKey(name), ...extra };
}

describe('planAdds', () => {
  it('adds everything to an empty list', () => {
    const plan = planAdds([ingredient('black beans', 2, 'can'), ingredient('onion', 1)], []);
    expect(plan.map((p) => p.action)).toEqual(['add', 'add']);
  });

  it('merges into an existing row instead of adding a second one', () => {
    const plan = planAdds(
      [ingredient('whole milk', 1, 'cup')],
      [row('a1', 'Milk', { quantity: 2, unit: 'cup' })],
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: 'merge', targetId: 'a1', quantity: 3, unit: 'cup' });
  });

  it('does not merge into a CHECKED row -- that item is already in the basket', () => {
    const plan = planAdds(
      [ingredient('milk', 1, 'cup')],
      [row('a1', 'Milk', { checked: true, quantity: 2, unit: 'cup' })],
    );
    expect(plan.map((p) => p.action)).toEqual(['add']);
  });

  it('treats a missing quantity as one of the thing', () => {
    const plan = planAdds([ingredient('onion')], [row('a1', 'Onions')]);
    expect(plan[0]).toMatchObject({ action: 'merge', quantity: 2 });
  });

  it('refuses to merge two real, different units', () => {
    const plan = planAdds(
      [ingredient('milk', 2, 'tbsp')],
      [row('a1', 'Milk', { quantity: 1, unit: 'cup' })],
    );
    expect(plan.map((p) => p.action)).toEqual(['add']);
  });

  it('merges when either side leaves the unit unspecified', () => {
    const plan = planAdds(
      [ingredient('milk', 2)],
      [row('a1', 'Milk', { quantity: 1, unit: 'cup' })],
    );
    expect(plan[0]).toMatchObject({ action: 'merge', quantity: 3, unit: 'cup' });
  });

  it('folds one recipe’s repeated ingredient into a single add', () => {
    // "2 cups milk" for the sauce and "1 cup milk" for the batter: one row, three cups.
    const plan = planAdds([ingredient('milk', 2, 'cup'), ingredient('whole milk', 1, 'cup')], []);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: 'add' });
    expect(plan[0]).toHaveProperty('item.quantity', 3);
  });

  it('folds a repeat into the RIGHT pending add when units split it in two', () => {
    // The bug an earlier name-based lookup had: three lines, two pending rows ("milk" in
    // cups and in tbsp), and the third has to land on the tbsp one.
    const plan = planAdds(
      [ingredient('milk', 1, 'cup'), ingredient('milk', 2, 'tbsp'), ingredient('milk', 1, 'tbsp')],
      [],
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]).toHaveProperty('item.quantity', 1); // cups, untouched
    expect(plan[1]).toHaveProperty('item.quantity', 3); // tbsp, 2 + 1
  });

  it('matches a legacy row that has no stored key, via its name', () => {
    const plan = planAdds(
      [ingredient('tomatoes', 1)],
      [{ id: 'old', name: 'Tomato', checked: false }],
    );
    expect(plan[0]).toMatchObject({ action: 'merge', targetId: 'old', quantity: 2 });
  });

  it('still adds an ingredient whose name cannot be normalized', () => {
    const plan = planAdds([{ key: 'x' as Item['key'], name: '???', category: 'other' }], []);
    expect(plan.map((p) => p.action)).toEqual(['add']);
  });
});
