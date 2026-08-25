/**
 * 🥫 Inventory data layer -- the Inventory team's shared API.
 *
 * Presence-based: we track WHETHER you have something, not how much.
 *
 * Doc IDs are deterministic: the normalized key itself. That is what makes
 * upsert-by-key a single idempotent setDoc instead of a racy query-read-branch, and
 * has(key) a single getDoc.
 *
 * POC note: single-user, no auth -- one shared pantry, like the existing groceries list.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { normalizeKey } from './items.js';
import type { InventoryItem, InventoryItemInput, ItemKey } from './types.js';

const COLLECTION = 'inventory';

/** Firestore's hard cap on operations per WriteBatch. */
const BATCH_LIMIT = 500;

/**
 * An inventory row as the UI holds it. Since auth came out, the doc ID *is* the key, so
 * `id` is now redundant with `key` -- it stays because six components already key off it,
 * and because it is the field that would have to change again if per-user IDs return.
 */
export type InventoryRow = InventoryItem & { id: string };

function inventoryRef(key: ItemKey) {
  return doc(db, COLLECTION, key);
}

/**
 * Firestore rejects `undefined` field values outright, and with {merge: true} a field
 * the caller never mentioned must stay untouched -- so drop absent fields entirely.
 */
function definedFields<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function toWriteData(input: InventoryItemInput): { key: ItemKey; data: object } {
  const key = input.key ?? normalizeKey(input.name);
  const data = {
    ...definedFields(input),
    key,
    updatedAt: serverTimestamp(),
  };
  return { key, data };
}

// --- Writes ------------------------------------------------------------------------------

/**
 * Add or update by key. Adding something you already have updates the existing row,
 * never creates a duplicate. `key` is derived from `name` when omitted.
 */
export async function upsertItem(input: InventoryItemInput): Promise<ItemKey> {
  const { key, data } = toWriteData(input);
  await setDoc(inventoryRef(key), data, { merge: true });
  return key;
}

/**
 * Upsert many items in writeBatch chunks (one shelf photo can produce 15+).
 * De-dupes by key first -- two set() calls on the same ref in one batch is an error,
 * and a photo genuinely can return "black beans" twice. Later entries win.
 */
export async function batchUpsertItems(inputs: InventoryItemInput[]): Promise<ItemKey[]> {
  const byKey = new Map<ItemKey, object>();
  for (const input of inputs) {
    const { key, data } = toWriteData(input);
    byKey.set(key, data);
  }

  const entries = [...byKey.entries()];
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const [key, data] of entries.slice(i, i + BATCH_LIMIT)) {
      batch.set(inventoryRef(key), data, { merge: true });
    }
    await batch.commit();
  }
  return [...byKey.keys()];
}

/**
 * Patch fields on an existing item. `key` is the identity (it IS the doc ID), so the
 * patch type excludes it.
 */
export async function updateItem(
  key: ItemKey,
  patch: Partial<Omit<InventoryItemInput, 'key'>>,
): Promise<void> {
  await setDoc(
    inventoryRef(key),
    { ...definedFields(patch), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function removeItem(key: ItemKey): Promise<void> {
  await deleteDoc(inventoryRef(key));
}

/**
 * Rename an item -- which is not an update, because the key IS the document ID.
 *
 * ⚠️ Editing "chiken" to "chicken" changes normalizeKey()'s output and therefore the
 * document it lives at, so this is write-new-then-delete-old. updateItem() is only for
 * when the name (and so the key) is staying put; using it for a rename would leave the
 * old row behind and silently duplicate the item.
 *
 * If the new key is one you already have, the upsert merges into that row and the old row
 * is dropped -- fixing a typo de-dupes as a side effect, which is the behaviour you want.
 */
export async function renameItem(
  previousKey: ItemKey,
  input: InventoryItemInput,
): Promise<ItemKey> {
  const nextKey = input.key ?? normalizeKey(input.name);
  if (nextKey === previousKey) return upsertItem(input);

  await upsertItem({ ...input, key: nextKey });
  await removeItem(previousKey);
  return nextKey;
}

// --- Reads: the shared API other teams depend on -----------------------------------------

/** I2 (Grocery): do I already own this? One getDoc -- the cheapest read Firestore has. */
export async function has(key: ItemKey): Promise<boolean> {
  const snap = await getDoc(inventoryRef(key));
  return snap.exists();
}

/**
 * I2 for a whole grocery list in one pass. Parallel doc lookups rather than an `in`
 * query, which caps at 30 values.
 */
export async function hasMany(keys: ItemKey[]): Promise<Record<string, boolean>> {
  const unique = [...new Set(keys)];
  const snaps = await Promise.all(unique.map((k) => getDoc(inventoryRef(k))));
  return Object.fromEntries(unique.map((k, i) => [k, snaps[i]?.exists() ?? false]));
}

/** I5 (Recipe): every key in the pantry, for AI recipe generation. */
export async function getAllKeys(): Promise<ItemKey[]> {
  const snap = await getDocs(collection(db, COLLECTION));
  return snap.docs.map((d) => (d.data() as InventoryItem).key);
}

export async function listItems(): Promise<InventoryItem[]> {
  const snap = await getDocs(collection(db, COLLECTION));
  return snap.docs.map((d) => d.data() as InventoryItem);
}

/**
 * Real-time feed for the pantry UI. serverTimestamps:'estimate' fills the local-echo
 * null from serverTimestamp() so lists sorted on updatedAt don't flicker on write.
 * Grouping (location, then category) is the caller's job -- Firestore can't group.
 *
 * Pass onError. An onSnapshot listener without one swallows a failed listen into an
 * unhandled console error and never delivers a first snapshot, leaving a UI waiting on
 * something that is not coming. Open rules make a denial unlikely, not impossible: an
 * offline start, a blocked request, or rules that were never published all land here.
 */
export function subscribeToInventory(
  callback: (items: InventoryItem[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      callback(
        snap.docs.map((d) => d.data({ serverTimestamps: 'estimate' }) as InventoryItem),
      );
    },
    onError,
  );
}
