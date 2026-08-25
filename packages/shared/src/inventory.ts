/**
 * 🥫 Inventory data layer -- the Inventory team's shared API.
 *
 * Presence-based: we track WHETHER you have something, not how much.
 *
 * Doc IDs are deterministic (`${uid}__${key}`), which is what makes upsert-by-key a
 * single idempotent setDoc instead of a racy query-read-branch, and has(key) a single
 * getDoc. The firestore rules pin this format on create.
 *
 * Callers must ensureSignedIn() first; every function here throws otherwise.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { currentUid, db } from './firebase.js';
import { normalizeKey } from './items.js';
import type { InventoryItem, InventoryItemInput, ItemKey } from './types.js';

const COLLECTION = 'inventory';

/** Firestore's hard cap on operations per WriteBatch. */
const BATCH_LIMIT = 500;

/**
 * An inventory row as the UI holds it: the stored shape plus its document id. The id is
 * derivable (`${uid}__${key}`), but carrying it lets React key off it directly.
 */
export type InventoryRow = InventoryItem & { id: string };

function docIdFor(uid: string, key: ItemKey): string {
  return `${uid}__${key}`;
}

function inventoryRef(uid: string, key: ItemKey) {
  return doc(db, COLLECTION, docIdFor(uid, key));
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

function toWriteData(uid: string, input: InventoryItemInput): { key: ItemKey; data: object } {
  const key = input.key ?? normalizeKey(input.name);
  const data = {
    ...definedFields(input),
    key,
    userId: uid,
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
  const uid = currentUid();
  const { key, data } = toWriteData(uid, input);
  await setDoc(inventoryRef(uid, key), data, { merge: true });
  return key;
}

/**
 * Upsert many items in writeBatch chunks (one shelf photo can produce 15+).
 * De-dupes by key first -- two set() calls on the same ref in one batch is an error,
 * and a photo genuinely can return "black beans" twice. Later entries win.
 */
export async function batchUpsertItems(inputs: InventoryItemInput[]): Promise<ItemKey[]> {
  const uid = currentUid();
  const byKey = new Map<ItemKey, object>();
  for (const input of inputs) {
    const { key, data } = toWriteData(uid, input);
    byKey.set(key, data);
  }

  const entries = [...byKey.entries()];
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const [key, data] of entries.slice(i, i + BATCH_LIMIT)) {
      batch.set(inventoryRef(uid, key), data, { merge: true });
    }
    await batch.commit();
  }
  return [...byKey.keys()];
}

/**
 * Patch fields on an existing item. `key` and `userId` are frozen by the security
 * rules (they would orphan the doc from its own ID), so the patch type excludes them.
 */
export async function updateItem(
  key: ItemKey,
  patch: Partial<Omit<InventoryItemInput, 'key'>>,
): Promise<void> {
  const uid = currentUid();
  await setDoc(
    inventoryRef(uid, key),
    { ...definedFields(patch), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function removeItem(key: ItemKey): Promise<void> {
  await deleteDoc(inventoryRef(currentUid(), key));
}

/**
 * Rename an item -- which, because the doc ID is derived from the key, is not an update.
 *
 * ⚠️ Editing "chiken" to "chicken" changes normalizeKey()'s output, which changes the
 * document ID. The rules freeze `key` on update precisely so a row can never drift away
 * from the ID it lives at, so this is a write-new-then-delete-old, not a patch. Reach for
 * updateItem() only when the name (and therefore the key) is staying put.
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
  const snap = await getDoc(inventoryRef(currentUid(), key));
  return snap.exists();
}

/**
 * I2 for a whole grocery list in one pass. Parallel doc lookups rather than an `in`
 * query, which caps at 30 values.
 */
export async function hasMany(keys: ItemKey[]): Promise<Record<string, boolean>> {
  const uid = currentUid();
  const unique = [...new Set(keys)];
  const snaps = await Promise.all(unique.map((k) => getDoc(inventoryRef(uid, k))));
  return Object.fromEntries(unique.map((k, i) => [k, snaps[i]?.exists() ?? false]));
}

/** The rules reject unconstrained collection reads -- every query must filter by userId. */
function myItemsQuery() {
  return query(collection(db, COLLECTION), where('userId', '==', currentUid()));
}

/** I5 (Recipe): every key in the pantry, for AI recipe generation. */
export async function getAllKeys(): Promise<ItemKey[]> {
  const snap = await getDocs(myItemsQuery());
  return snap.docs.map((d) => (d.data() as InventoryItem).key);
}

export async function listItems(): Promise<InventoryItem[]> {
  const snap = await getDocs(myItemsQuery());
  return snap.docs.map((d) => d.data() as InventoryItem);
}

/**
 * Real-time feed for the pantry UI. serverTimestamps:'estimate' fills the local-echo
 * null from serverTimestamp() so lists sorted on updatedAt don't flicker on write.
 * Grouping (location, then category) is the caller's job -- Firestore can't group.
 *
 * Pass onError. An onSnapshot listener without one swallows a failed listen into an
 * unhandled console error, and the most likely failure here -- rules not published yet,
 * so the very first listen is denied -- would otherwise leave a UI waiting on a first
 * snapshot that is never coming, with nothing to show for it.
 */
export function subscribeToInventory(
  callback: (items: InventoryItem[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    myItemsQuery(),
    (snap) => {
      callback(
        snap.docs.map((d) => d.data({ serverTimestamps: 'estimate' }) as InventoryItem),
      );
    },
    onError,
  );
}
