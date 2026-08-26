import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  db,
  normalizeKey,
  type Category,
  type GroceryItem,
  type ItemKey,
  type StoreMatch,
  type StoreProduct,
  type Unit,
} from '@grocery/shared';
import type { SendLineResult } from './api';
import { parseEntry, type ParsedEntry } from './parseEntry';

export type Row = GroceryItem & { id: string };

const groceries = () => collection(db, 'groceries');

/**
 * Strips undefined before writing. Firestore rejects undefined values outright, and the
 * optional fields on GroceryItem make it very easy to produce one by accident.
 */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * normalizeKey throws when a name has no identifying words left ("???", "---"). A key is
 * a nice-to-have on a grocery row and the read paths already tolerate its absence, so a
 * weird name loses cross-app matching rather than losing the item.
 */
function safeKey(name: string): ItemKey | undefined {
  try {
    return normalizeKey(name);
  } catch {
    return undefined;
  }
}

export function matchFromProduct(product: StoreProduct, locationId: string): StoreMatch {
  const out = product.stockLevel === 'TEMPORARILY_OUT_OF_STOCK';
  return {
    status: out ? 'unavailable' : 'matched',
    locationId,
    product,
    confidence: 1,
    chosenBy: 'user',
    cartQuantity: 1,
    resolvedAt: null,
    sentAt: null,
  };
}

// --- Adding ----------------------------------------------------------------------------

export interface AddResult {
  merged: boolean;
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

/** A null unit means "unspecified", which merges with anything. Different units do not. */
function unitsCompatible(a: Unit | null | undefined, b: Unit | null): boolean {
  return a == null || b == null || a === b;
}

/**
 * The row a new entry should fold into, if any.
 *
 * Only unchecked rows: a checked item is already in the basket, and bumping its quantity
 * would silently change something the user considers done.
 */
function mergeTarget(existing: Row[], entry: ParsedEntry): Row | null {
  const key = safeKey(entry.name);
  if (key === undefined) return null;
  return (
    existing.find(
      (row) =>
        !row.checked &&
        (row.key ?? safeKey(row.name)) === key &&
        unitsCompatible(row.unit, entry.unit),
    ) ?? null
  );
}

/** A row with no quantity means one of the thing, so adding another makes two. */
function mergedAmount(target: Row, entry: ParsedEntry): { quantity: number; unit: Unit | null } {
  return {
    quantity: (target.quantity ?? 1) + (entry.quantity ?? 1),
    unit: target.unit ?? entry.unit ?? null,
  };
}

export async function addPlainItem(raw: string, existing: Row[] = []): Promise<AddResult> {
  const entry = parseEntry(raw);
  const target = mergeTarget(existing, entry);

  if (target) {
    const amount = mergedAmount(target, entry);
    await updateDoc(doc(db, 'groceries', target.id), clean(amount));
    return { merged: true, name: target.name, ...amount };
  }

  await addDoc(
    groceries(),
    clean({
      name: entry.name,
      checked: false,
      createdAt: serverTimestamp(),
      key: safeKey(entry.name),
      quantity: entry.quantity,
      unit: entry.unit,
      source: 'manual',
    }),
  );
  return { merged: false, name: entry.name, quantity: entry.quantity, unit: entry.unit };
}

export async function addMatchedItem(
  raw: string,
  product: StoreProduct,
  locationId: string,
  existing: Row[] = [],
): Promise<AddResult> {
  const entry = parseEntry(raw);
  const target = mergeTarget(existing, entry);
  const match = matchFromProduct(product, locationId);

  if (target) {
    // The user just picked a product, so their choice replaces whatever was on the row.
    const amount = mergedAmount(target, entry);
    await updateDoc(
      doc(db, 'groceries', target.id),
      clean({
        ...amount,
        match,
        storeProductId: product.productId,
        category: product.category ?? undefined,
      }),
    );
    return { merged: true, name: target.name, ...amount };
  }

  await addDoc(
    groceries(),
    clean({
      name: entry.name,
      checked: false,
      createdAt: serverTimestamp(),
      key: safeKey(entry.name),
      quantity: entry.quantity,
      unit: entry.unit,
      category: product.category ?? undefined,
      source: 'manual',
      storeProductId: product.productId,
      match,
    }),
  );
  return { merged: false, name: entry.name, quantity: entry.quantity, unit: entry.unit };
}

// --- Editing ---------------------------------------------------------------------------

export function setMatch(id: string, match: StoreMatch): Promise<void> {
  return updateDoc(doc(db, 'groceries', id), {
    match,
    storeProductId: match.product?.productId ?? null,
    ...(match.product?.category ? { category: match.product.category as Category } : {}),
  });
}

/** How many packages to buy -- distinct from the list quantity. See StoreMatch.cartQuantity. */
export function setCartQuantity(id: string, match: StoreMatch, cartQuantity: number): Promise<void> {
  return updateDoc(doc(db, 'groceries', id), { match: { ...match, cartQuantity } });
}

export function setAmount(
  id: string,
  quantity: number | null,
  unit: Unit | null,
): Promise<void> {
  return updateDoc(doc(db, 'groceries', id), { quantity, unit });
}

export function toggleItem(item: Row): Promise<void> {
  return updateDoc(doc(db, 'groceries', item.id), { checked: !item.checked });
}

export function deleteItem(id: string): Promise<void> {
  return deleteDoc(doc(db, 'groceries', id));
}

export async function clearChecked(items: Row[]): Promise<number> {
  const checked = items.filter((i) => i.checked);
  if (checked.length === 0) return 0;
  const batch = writeBatch(db);
  for (const item of checked) batch.delete(doc(db, 'groceries', item.id));
  await batch.commit();
  return checked.length;
}

// --- Store switching -------------------------------------------------------------------

/** Drops the given rows back to 'unresolved' so they re-resolve against the new store. */
export async function resetMatches(rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const batch = writeBatch(db);
  for (const row of rows) {
    batch.update(doc(db, 'groceries', row.id), {
      match: { status: 'unresolved', locationId: null, product: null },
      storeProductId: null,
    });
  }
  await batch.commit();
  return rows.length;
}

// --- Cart ------------------------------------------------------------------------------

/**
 * Record what actually landed in the store cart.
 *
 * Only the successful lines are touched. A failed line stays 'matched', which leaves it in
 * the next send's plan -- so "try again" is the same button, doing the same thing, to a
 * smaller list. Marking it 'sent' would hide a line that never arrived.
 *
 * Dotted field paths rather than a whole `match` object: the resolver's candidates,
 * confidence and chosenBy are still true after a send, and rewriting the map would drop
 * them. `sentAt` reads back null on the local echo, like every serverTimestamp().
 */
export async function markSent(results: SendLineResult[]): Promise<number> {
  const ok = results.filter((r) => r.ok);
  if (ok.length === 0) return 0;
  const batch = writeBatch(db);
  for (const line of ok) {
    batch.update(doc(db, 'groceries', line.itemId), {
      'match.status': 'sent',
      'match.sentAt': serverTimestamp(),
    });
  }
  await batch.commit();
  return ok.length;
}
