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
  type StoreMatch,
  type StoreProduct,
} from '@grocery/shared';
import { parseEntry } from './parseEntry';

export type Row = GroceryItem & { id: string };

const groceries = () => collection(db, 'groceries');

/**
 * Strips undefined before writing. Firestore rejects undefined values outright, and the
 * optional fields on GroceryItem make it very easy to produce one by accident.
 */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
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

export async function addPlainItem(raw: string): Promise<void> {
  const { name, quantity, unit } = parseEntry(raw);
  await addDoc(
    groceries(),
    clean({
      name,
      checked: false,
      createdAt: serverTimestamp(),
      key: normalizeKey(name),
      quantity,
      unit,
      source: 'manual',
    }),
  );
}

export async function addMatchedItem(
  raw: string,
  product: StoreProduct,
  locationId: string,
): Promise<void> {
  const { name, quantity, unit } = parseEntry(raw);
  await addDoc(
    groceries(),
    clean({
      name,
      checked: false,
      createdAt: serverTimestamp(),
      key: normalizeKey(name),
      quantity,
      unit,
      category: product.category ?? undefined,
      source: 'manual',
      storeProductId: product.productId,
      match: matchFromProduct(product, locationId),
    }),
  );
}

export function setMatch(id: string, match: StoreMatch): Promise<void> {
  return updateDoc(doc(db, 'groceries', id), {
    match,
    storeProductId: match.product?.productId ?? null,
    ...(match.product?.category ? { category: match.product.category as Category } : {}),
  });
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
