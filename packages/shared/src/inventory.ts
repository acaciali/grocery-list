/**
 * 🥫 Inventory data layer. Owned by the Inventory team, but it lives in `shared` on
 * purpose: Grocery imports `has()` for I2 and Recipe imports `getAllKeys()` for I5.
 * Additive -- this file is new and nothing existing changed. Announced in the channel.
 *
 * ⭐ THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM
 *
 * Doc IDs are deterministic: `${uid}__${key}`. That is what turns upsert-by-key into a
 * single idempotent setDoc instead of a racy read-then-branch, and it is pinned in
 * firestore.rules so a client cannot park a well-formed row at some other ID and make
 * every later upsert silently miss it. The photo flow leans on this hard -- fifteen
 * detected items become fifteen idempotent writes in one batch, and re-running the same
 * photo changes nothing.
 *
 * ⚠️ TWO FIRESTORE RULES GOTCHAS THIS FILE EXISTS TO ABSORB
 *
 * 1. `read` tests `resource.data.userId`, so Firestore evaluates it against the QUERY,
 *    not the rows it would return. An unconstrained getDocs(collection(db,'inventory'))
 *    is rejected outright rather than filtered. Every read below constrains on userId.
 *
 * 2. For a `get` on a document that does not exist, `resource` is null, and evaluating
 *    `resource.data.userId` against null errors -- which denies. So a plain getDoc() for
 *    a key you do not have throws permission-denied instead of returning "not found".
 *    That is why `has()` is a query with limit(1) and not the getDoc it looks like it
 *    should be. Do not "simplify" it back. 💀
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type FieldValue,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { normalizeKey } from './items.js';
import type { InventoryItem, InventoryItemInput, ItemKey } from './types.js';

const COLLECTION = 'inventory';

/** An inventory row as the UI holds it: the stored shape plus its document id. */
export type InventoryRow = InventoryItem & { id: string };

/** serverTimestamp() is a FieldValue on the way out and a Timestamp on the way back. */
type InventoryWrite = Omit<InventoryItem, 'updatedAt'> & { updatedAt: FieldValue };

/**
 * The deterministic id. Exported because the review grid needs to know whether a detected
 * item is already in the pantry without doing a round-trip per card.
 */
export function inventoryDocId(uid: string, key: ItemKey): string {
  return `${uid}__${key}`;
}

/**
 * Firestore rejects `undefined` field values outright. Optional fields therefore have to
 * be omitted rather than set, which is fiddlier than it sounds when a caller passes
 * `quantity: undefined` from an empty form input.
 */
function withDefined<T extends object>(base: T, optional: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function toWrite(uid: string, input: InventoryItemInput): InventoryWrite {
  // Derive the key from the display name unless the caller already has a real one --
  // the photo path normalizes server-side, so it passes its key straight through.
  const key = input.key ?? normalizeKey(input.name);
  const base: InventoryWrite = {
    key,
    userId: uid,
    name: input.name.trim(),
    category: input.category,
    location: input.location,
    addedVia: input.addedVia,
    updatedAt: serverTimestamp(),
  };
  return withDefined(base, {
    confidence: input.addedVia === 'photo' ? input.confidence : null,
    quantity: input.quantity,
    unit: input.unit,
    upc: input.upc,
    expiresAt: input.expiresAt,
  });
}

/**
 * Live pantry for one user. Presence-based, so there is no server-side ordering to
 * preserve -- callers group and sort in memory, which also dodges the composite index
 * that where(userId) + orderBy(updatedAt) would otherwise need.
 */
export function subscribeInventory(
  uid: string,
  onRows: (rows: InventoryRow[]) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  const q = query(collection(db, COLLECTION), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      onRows(
        snap.docs.map((d) => ({
          id: d.id,
          // 'estimate' fills the local-echo null from serverTimestamp() so a freshly
          // written row doesn't flicker before the server round-trip lands.
          ...(d.data({ serverTimestamps: 'estimate' }) as InventoryItem),
        })),
      );
    },
    onError,
  );
}

/**
 * Add-or-update by key. Adding something you already have updates that row; it never
 * creates a second one. `merge: true` means a manual edit that omits `upc` does not
 * clear a UPC an earlier barcode scan wrote.
 */
export async function upsertItem(uid: string, input: InventoryItemInput): Promise<ItemKey> {
  const payload = toWrite(uid, input);
  await setDoc(doc(db, COLLECTION, inventoryDocId(uid, payload.key)), payload, { merge: true });
  return payload.key;
}

/**
 * One photo can produce fifteen items. Fifteen separate writes is fifteen round-trips and
 * a partially-populated pantry if the tab closes halfway; a batch is one atomic commit.
 *
 * De-duped by key first: two shelves in one session can both surface "olive oil", and a
 * batch containing the same document ref twice is a runtime error, not a silent merge.
 */
export async function upsertMany(uid: string, inputs: InventoryItemInput[]): Promise<ItemKey[]> {
  const byKey = new Map<ItemKey, InventoryWrite>();
  for (const input of inputs) {
    const payload = toWrite(uid, input);
    byKey.set(payload.key, payload);
  }
  if (byKey.size === 0) return [];

  // Firestore caps a batch at 500 writes. A pantry will never hit that, but chunking is
  // three lines and the failure mode without it is a hard error mid-demo.
  const payloads = [...byKey.values()];
  for (let i = 0; i < payloads.length; i += 500) {
    const batch = writeBatch(db);
    for (const payload of payloads.slice(i, i + 500)) {
      batch.set(doc(db, COLLECTION, inventoryDocId(uid, payload.key)), payload, { merge: true });
    }
    await batch.commit();
  }
  return payloads.map((p) => p.key);
}

/** Delete by key. Idempotent -- deleting something already gone is not an error. */
export async function deleteItem(uid: string, key: ItemKey): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, inventoryDocId(uid, key)));
}

/**
 * ⭐ The shared read API. Grocery calls this per key before adding to the list, so it can
 * skip what you already own (I2).
 *
 * A query rather than a getDoc, for the missing-document reason in the header comment.
 * Two equality filters are served by zigzag merge on the automatic single-field indexes,
 * so this needs no composite index.
 */
export async function has(uid: string, key: ItemKey): Promise<boolean> {
  const q = query(
    collection(db, COLLECTION),
    where('userId', '==', uid),
    where('key', '==', key),
    limit(1),
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

/**
 * Every key in the pantry, for Recipe's AI generation (I5). Because the photo path already
 * ran normalizeKey() server-side, a photographed pantry feeds this for free. ✨
 */
export async function getAllKeys(uid: string): Promise<ItemKey[]> {
  const q = query(collection(db, COLLECTION), where('userId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => (d.data() as InventoryItem).key);
}

/**
 * Rename an item -- which, because the doc id is derived from the key, is not an update.
 *
 * ⚠️ Editing "chiken" to "chicken" changes normalizeKey()'s output, which changes the
 * document id. firestore.rules freezes `key` on update precisely so a row can never drift
 * away from the id it lives at, so this is a write-new-then-delete-old, not a patch.
 *
 * If the new key is one you already have, the upsert merges into that row and the old row
 * is dropped -- fixing a typo de-dupes as a side effect, which is the behaviour you want.
 */
export async function renameItem(
  uid: string,
  previousKey: ItemKey,
  input: InventoryItemInput,
): Promise<ItemKey> {
  const nextKey = input.key ?? normalizeKey(input.name);
  if (nextKey === previousKey) return upsertItem(uid, input);

  await upsertItem(uid, { ...input, key: nextKey });
  await deleteItem(uid, previousKey);
  return nextKey;
}
