/**
 * 🔗 I1 · Recipe → Grocery, the Grocery half.
 *
 * PLAN.md: "Writes to `groceries` with `source: 'recipe'` and `sourceId`. De-dupe by
 * `key`: if it is already on the list, bump quantity instead of adding a second row."
 * grocery.md's matching duty: "accept batched ingredient adds; de-dupe by `key`; return a
 * summary of added vs. merged."
 *
 * Lives in routes/grocery/ because writing to `groceries` is Grocery's job -- the Recipe
 * surface owns the button and the review sheet, this owns the write. Split that way, the
 * merge rules have one home no matter which surface ends up sending items here (Inventory's
 * "running low" list is the obvious next caller).
 *
 * `planAdds` is deliberately pure so the merge arithmetic is checkable without Firestore.
 * apps/web has no test runner on this branch; the moment it gets one this is the file to
 * point it at.
 */
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  db,
  normalizeKey,
  type GroceryItem,
  type Item,
  type ItemKey,
  type Unit,
} from '@grocery/shared';

/**
 * normalizeKey throws when a name has no identifying words left ("a pinch", "???"). A key
 * is a nice-to-have on a grocery row and every read path already tolerates its absence, so
 * a weird name loses cross-app matching rather than losing the item.
 */
export function safeKey(name: string): ItemKey | undefined {
  try {
    return normalizeKey(name);
  } catch {
    return undefined;
  }
}

/** As much of an existing `groceries` row as the merge actually needs. */
export interface ExistingRow {
  id: string;
  name: string;
  checked: boolean;
  /** Absent on legacy rows written before `key` existed -- derived from `name` when so. */
  key?: ItemKey;
  quantity?: number | null;
  unit?: Unit | null;
}

/** One planned write. `merge` bumps an existing row; `add` creates one. */
export type PlannedWrite =
  | { action: 'add'; item: Item }
  | {
      action: 'merge';
      item: Item;
      targetId: string;
      /** The name already on the list, which is what the user will recognize. */
      targetName: string;
      quantity: number;
      unit: Unit | null;
    };

export interface AddSummary {
  added: number;
  merged: number;
  /** Names of rows whose quantity was bumped, for an honest confirmation message. */
  mergedNames: string[];
}

/** A null unit means "unspecified", which merges with anything. Two real units must match. */
function unitsCompatible(a: Unit | null | undefined, b: Unit | null | undefined): boolean {
  return a == null || b == null || a === b;
}

/** A row with no quantity means one of the thing, so adding another makes two. */
function bump(target: Pick<ExistingRow, 'quantity' | 'unit'>, item: Item): {
  quantity: number;
  unit: Unit | null;
} {
  return {
    quantity: (target.quantity ?? 1) + (item.quantity ?? 1),
    unit: target.unit ?? item.unit ?? null,
  };
}

/**
 * Decide what each ingredient should do to the list.
 *
 * Two subtleties, both of which produce a duplicate row if ignored:
 *
 *  1. Only UNCHECKED rows are merge targets. A checked row is already in the basket, and
 *     silently bumping its quantity would change something the user considers done.
 *
 *  2. One recipe can carry the same key twice -- "2 cups milk" for the sauce and "1 cup
 *     milk" for the batter both normalize to `milk`. So the plan is built against a
 *     working copy that accumulates as it goes: the second line merges into whatever the
 *     first line decided, rather than both independently deciding to add a fresh row.
 */
export function planAdds(items: Item[], existing: ExistingRow[]): PlannedWrite[] {
  const writes: PlannedWrite[] = [];

  /**
   * Working copy of the merge targets, updated as the plan is built. Exactly one of `id`
   * and `writeIndex` is set: `id` for a row that already exists in Firestore, `writeIndex`
   * for one this batch is about to create, pointing at the `add` that will create it.
   *
   * The index matters -- an earlier version looked the pending write up by name, which
   * picks the wrong row as soon as one ingredient appears twice with incompatible units
   * ("1 cup milk" then "2 tbsp milk" are two separate adds, both named "milk").
   */
  const targets: {
    key: ItemKey | undefined;
    id: string | null;
    writeIndex: number | null;
    name: string;
    quantity: number | null;
    unit: Unit | null;
  }[] = existing
    .filter((row) => !row.checked)
    .map((row) => ({
      key: row.key ?? safeKey(row.name),
      id: row.id,
      writeIndex: null,
      name: row.name,
      quantity: row.quantity ?? null,
      unit: row.unit ?? null,
    }));

  for (const item of items) {
    const key = safeKey(item.name);
    const target =
      key === undefined
        ? undefined
        : targets.find((t) => t.key === key && unitsCompatible(t.unit, item.unit));

    if (target === undefined) {
      writes.push({ action: 'add', item });
      // Visible to later lines in this same batch, so a repeated ingredient folds in.
      targets.push({
        key,
        id: null,
        writeIndex: writes.length - 1,
        name: item.name,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
      });
      continue;
    }

    const amount = bump(target, item);
    target.quantity = amount.quantity;
    target.unit = amount.unit;

    if (target.id === null) {
      // Folding into a row this batch is still about to create: rewrite that pending add
      // rather than emitting a merge against a document that does not exist yet.
      const pending = writes[target.writeIndex as number];
      if (pending?.action === 'add') {
        pending.item = { ...pending.item, quantity: amount.quantity, unit: amount.unit };
      }
      continue;
    }

    writes.push({
      action: 'merge',
      item,
      targetId: target.id,
      targetName: target.name,
      quantity: amount.quantity,
      unit: amount.unit,
    });
  }

  return writes;
}

/** Firestore rejects `undefined` outright, and GroceryItem is mostly optional fields. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Read the list as it is right now. The merge has to see concurrent edits, not stale UI. */
export async function readGroceryList(): Promise<ExistingRow[]> {
  const snap = await getDocs(collection(db, 'groceries'));
  return snap.docs.map((d) => {
    const data = d.data() as GroceryItem;
    return {
      id: d.id,
      name: data.name,
      checked: data.checked,
      key: data.key,
      quantity: data.quantity,
      unit: data.unit,
    };
  });
}

/**
 * Add a recipe's ingredients to the grocery list in one batch.
 *
 * `sourceId` is the recipe's doc id, which is what makes a row traceable back to the
 * recipe that put it there (grocery.md's source badge links on it).
 *
 * One batch, so a half-written list is not a state the user can end up in. A recipe never
 * approaches Firestore's 500-op batch cap, so there is no chunking here -- unlike
 * shared/inventory.ts, where one shelf photo genuinely can.
 */
export async function addRecipeIngredients(
  recipeId: string,
  items: Item[],
): Promise<AddSummary> {
  if (items.length === 0) return { added: 0, merged: 0, mergedNames: [] };

  const writes = planAdds(items, await readGroceryList());
  const batch = writeBatch(db);
  const groceries = collection(db, 'groceries');
  const mergedNames: string[] = [];

  for (const write of writes) {
    if (write.action === 'add') {
      batch.set(
        doc(groceries),
        clean({
          name: write.item.name,
          checked: false,
          createdAt: serverTimestamp(),
          key: safeKey(write.item.name),
          quantity: write.item.quantity ?? null,
          unit: write.item.unit ?? null,
          category: write.item.category,
          source: 'recipe',
          sourceId: recipeId,
        }),
      );
      continue;
    }

    // Only the amount changes. Leaving `source` alone is deliberate: a row the user typed
    // by hand and then topped up from a recipe is still theirs, and overwriting `sourceId`
    // would relabel it as belonging to whichever recipe touched it last.
    batch.update(doc(groceries, write.targetId), {
      quantity: write.quantity,
      unit: write.unit,
    });
    mergedNames.push(write.targetName);
  }

  await batch.commit();

  return {
    added: writes.filter((w) => w.action === 'add').length,
    merged: mergedNames.length,
    mergedNames,
  };
}
