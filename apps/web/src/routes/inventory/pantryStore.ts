/**
 * Where the pantry lives. Two implementations of one interface; `pantry` at the bottom
 * picks which one the UI talks to.
 *
 * ⭐ THE BACKEND IS THE DEFAULT. `pantry` is the Firestore store, so the pantry is real,
 * per-user and synced across devices. The browser-only stub is still here because it
 * needs no Firebase project, no rules and no network -- which is what you want for UI
 * work, for a plane, and for a fresh clone that has not been through docs/SETUP.md yet.
 * To get it, put this in apps/web/.env.local:
 *
 *     VITE_PANTRY=local
 *
 * And while developing against Firestore, VITE_USE_EMULATORS=true in the same file
 * points reads and writes at `npm run emulators` instead of the live project.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────
 * 🔌 THE SEAM. Nothing in the UI knows which implementation it is talking to. Components
 * take `uid` and call PantryStore methods; that is the whole contract.
 *
 * The Firestore store forwards to `packages/shared/src/inventory.ts`, which is also where
 * Grocery gets `has()` for I2 and Recipe gets `getAllKeys()` for I5 -- which is why the
 * data layer lives in shared and only this adapter lives here.
 *
 * Two mismatches the adapter absorbs, rather than pushing onto components:
 *
 *   - shared takes the uid from `currentUid()` instead of a parameter, so every method
 *     here ignores its `uid` argument. signIn() must resolve before anything else runs;
 *     useInventory guarantees that ordering.
 *   - shared's subscribe returns InventoryItem[] with no doc id. The id is derivable
 *     (`${uid}__${key}`), so the adapter synthesizes it, exactly as the stub does.
 * ───────────────────────────────────────────────────────────────────────────────────────
 */
import { Timestamp } from 'firebase/firestore';
import {
  batchUpsertItems,
  ensureSignedIn,
  getAllKeys,
  has,
  normalizeKey,
  removeItem,
  renameItem,
  subscribeToInventory,
  upsertItem,
  type Category,
  type InventoryItem,
  type InventoryItemInput,
  type InventoryRow,
  type ItemKey,
  type StorageLocation,
} from '@grocery/shared';

export interface PantryStore {
  /** True while the pantry is browser-only. The UI says so rather than implying sync. */
  readonly isLocal: boolean;
  /** Resolves to the uid every other method is scoped by. */
  signIn(): Promise<string>;
  /**
   * onError matters once this is a real backend: a denied listen (rules not published)
   * never delivers a first snapshot, so without it the UI waits forever on `loading`.
   */
  subscribe(
    uid: string,
    onRows: (rows: InventoryRow[]) => void,
    onError?: (message: string) => void,
  ): () => void;
  upsertItem(uid: string, input: InventoryItemInput): Promise<ItemKey>;
  upsertMany(uid: string, inputs: InventoryItemInput[]): Promise<ItemKey[]>;
  deleteItem(uid: string, key: ItemKey): Promise<void>;
  renameItem(uid: string, previousKey: ItemKey, input: InventoryItemInput): Promise<ItemKey>;
  /** Grocery's I2 dependency (skip what you already own). */
  has(uid: string, key: ItemKey): Promise<boolean>;
  /** Recipe's I5 dependency (AI recipe generation from your pantry). */
  getAllKeys(uid: string): Promise<ItemKey[]>;
  /** Stub-only: refill the demo pantry after clearing it. */
  loadSample(uid: string): Promise<void>;
  /** Stub-only: empty it, to check the empty state. */
  clearAll(uid: string): Promise<void>;
}

const STORAGE_KEY = 'kitchenloop.pantry.v1';
/** Separate flag so clearing the pantry doesn't just re-seed on the next reload. */
const SEEDED_KEY = 'kitchenloop.pantry.seeded';
const LOCAL_UID = 'local';

/** Stored shape: same as InventoryItem, but timestamps become epoch millis because a
 *  Firestore Timestamp does not survive JSON.stringify. */
type StoredItem = Omit<InventoryItem, 'updatedAt' | 'expiresAt'> & {
  updatedAt: number;
  expiresAt?: number | null;
};

function readAll(): StoredItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredItem[]) : [];
  } catch {
    // Corrupt JSON, or localStorage unavailable (Safari private mode throws on access).
    // Neither should brick the page.
    return [];
  }
}

/** Subscribers in this tab. localStorage fires no event for the tab that did the writing. */
const listeners = new Set<() => void>();

function writeAll(items: StoredItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Out of quota or blocked. Still notify, so this session stays correct in memory.
  }
  listeners.forEach((fn) => fn());
}

function toRow(item: StoredItem): InventoryRow {
  return {
    ...item,
    // Mirrors the `${uid}__${key}` id the Firestore side uses, so anything keying off id
    // behaves identically after the swap.
    id: `${LOCAL_UID}__${item.key}`,
    // Timestamp is a plain value class -- constructing one touches no network and needs no
    // initialized app. Using the real type keeps InventoryRow honest so components stay
    // backend-blind and the swap changes nothing.
    updatedAt: Timestamp.fromMillis(item.updatedAt),
    expiresAt: item.expiresAt == null ? null : Timestamp.fromMillis(item.expiresAt),
  };
}

function toStored(input: InventoryItemInput): StoredItem {
  const key = input.key ?? normalizeKey(input.name);
  const stored: StoredItem = {
    key,
    userId: LOCAL_UID,
    name: input.name.trim(),
    category: input.category,
    location: input.location,
    addedVia: input.addedVia,
    // Deliberately cleared when the row is not a photo guess: a human editing a row is
    // vouching for it, so a stale confidence score must not linger.
    confidence: input.addedVia === 'photo' ? (input.confidence ?? null) : null,
    updatedAt: Date.now(),
  };

  // ⭐ Only write optionals the caller actually supplied. An absent field is left alone by
  // the merge in putByKey, while an explicit `null` clears it -- which is exactly what
  // Firestore's `merge: true` does, so both backends behave identically. Concretely:
  // tapping the "Milk" staple must not wipe the expiry date you typed in earlier, but
  // clearing the date field in the edit form must.
  if (input.quantity !== undefined) stored.quantity = input.quantity;
  if (input.unit !== undefined) stored.unit = input.unit;
  if (input.upc !== undefined) stored.upc = input.upc;
  if (input.expiresAt !== undefined) {
    stored.expiresAt = input.expiresAt === null ? null : input.expiresAt.toMillis();
  }

  return stored;
}

/**
 * Upsert-by-key: adding something you already have updates that row, never creates a
 * duplicate. Same semantics the Firestore side gets from its deterministic doc ids, so
 * the behaviour people see now is the behaviour they get after the swap.
 */
function putByKey(items: StoredItem[], next: StoredItem): StoredItem[] {
  const index = items.findIndex((i) => i.key === next.key);
  if (index === -1) return [...items, next];
  const merged = [...items];
  merged[index] = { ...items[index], ...next };
  return merged;
}

/**
 * ~15 items spread across all three locations and several categories, so the grouped list,
 * the filter chips and search all have something real to work on the moment you open the
 * tab. Also covers PLAN.md's Phase 4 "seed a demo account with ~15 pantry items".
 */
const SAMPLE: readonly { name: string; category: Category; location: StorageLocation }[] = [
  { name: 'Whole milk', category: 'dairy', location: 'fridge' },
  { name: 'Eggs', category: 'dairy', location: 'fridge' },
  { name: 'Cheddar cheese', category: 'dairy', location: 'fridge' },
  { name: 'Baby spinach', category: 'produce', location: 'fridge' },
  { name: 'Carrots', category: 'produce', location: 'fridge' },
  { name: 'Onions', category: 'produce', location: 'pantry' },
  { name: 'Garlic', category: 'produce', location: 'pantry' },
  { name: 'Olive oil', category: 'pantry', location: 'pantry' },
  { name: 'White rice', category: 'pantry', location: 'pantry' },
  { name: 'Spaghetti', category: 'pantry', location: 'pantry' },
  { name: 'Black beans', category: 'canned', location: 'pantry' },
  { name: 'Diced tomatoes', category: 'canned', location: 'pantry' },
  { name: 'Cinnamon', category: 'spices', location: 'pantry' },
  { name: 'Chicken breast', category: 'meat', location: 'freezer' },
  { name: 'Frozen peas', category: 'frozen', location: 'freezer' },
];

function sampleItems(): StoredItem[] {
  return SAMPLE.map((s) => toStored({ ...s, addedVia: 'manual' }));
}

const localPantry: PantryStore = {
  isLocal: true,

  async signIn() {
    // First run only: drop the demo pantry in so the page has something to show. The
    // separate seeded flag means "Clear" actually stays cleared across reloads.
    try {
      if (!localStorage.getItem(SEEDED_KEY)) {
        localStorage.setItem(SEEDED_KEY, '1');
        if (readAll().length === 0) writeAll(sampleItems());
      }
    } catch {
      // localStorage blocked -- the app still runs, just with an empty pantry.
    }
    return LOCAL_UID;
  },

  subscribe(_uid, onRows) {
    const push = () => onRows(readAll().map(toRow));
    listeners.add(push);
    // Cross-tab sync for one line.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) push();
    };
    window.addEventListener('storage', onStorage);
    push();
    return () => {
      listeners.delete(push);
      window.removeEventListener('storage', onStorage);
    };
  },

  async upsertItem(_uid, input) {
    const next = toStored(input);
    writeAll(putByKey(readAll(), next));
    return next.key;
  },

  async upsertMany(_uid, inputs) {
    // Batched into one write, mirroring the single writeBatch commit on the Firestore
    // side: one photo producing fifteen items is one update, not fifteen renders.
    let items = readAll();
    const keys: ItemKey[] = [];
    for (const input of inputs) {
      const next = toStored(input);
      items = putByKey(items, next);
      keys.push(next.key);
    }
    writeAll(items);
    return keys;
  },

  async deleteItem(_uid, key) {
    writeAll(readAll().filter((i) => i.key !== key));
  },

  async renameItem(_uid, previousKey, input) {
    const nextKey = input.key ?? normalizeKey(input.name);
    const next = toStored({ ...input, key: nextKey });
    let items = readAll();
    // Renaming into a key you already have merges the two rows -- fixing a typo de-dupes,
    // exactly as it does on the Firestore side where the doc id is derived from the key.
    if (nextKey !== previousKey) items = items.filter((i) => i.key !== previousKey);
    writeAll(putByKey(items, next));
    return nextKey;
  },

  async has(_uid, key) {
    return readAll().some((i) => i.key === key);
  },

  async getAllKeys() {
    return readAll().map((i) => i.key);
  },

  async loadSample() {
    let items = readAll();
    for (const item of sampleItems()) items = putByKey(items, item);
    writeAll(items);
  },

  async clearAll() {
    writeAll([]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// 🔥 The real one: Firestore, via the shared data layer.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Confidence is a property of a *guess*, so a row that is no longer a guess must not keep
 * one. The stub clears it on every write; shared's `definedFields` only drops `undefined`,
 * so an untouched confidence would survive a merge and a photo-added item edited by hand
 * would keep its old score. Normalizing here keeps the two stores byte-comparable rather
 * than relying on every component to remember.
 */
function normalizeConfidence(input: InventoryItemInput): InventoryItemInput {
  return {
    ...input,
    confidence: input.addedVia === 'photo' ? (input.confidence ?? null) : null,
  };
}

/** The doc id shared writes to. Derivable, so no extra read to learn it. */
function rowId(uid: string, key: ItemKey): string {
  return `${uid}__${key}`;
}

const firestorePantry: PantryStore = {
  isLocal: false,

  async signIn() {
    // Anonymous auth: a stable uid per browser, no account, no password. Every other
    // method here reads that uid back out of the SDK via currentUid(), so this must
    // resolve before any of them are called.
    const user = await ensureSignedIn();
    return user.uid;
  },

  subscribe(uid, onRows, onError) {
    return subscribeToInventory(
      (items) => onRows(items.map((item) => ({ ...item, id: rowId(uid, item.key) }))),
      (err) => {
        console.error('[pantry] listen failed', err);
        // permission-denied here almost always means firestore.rules was never published
        // to this project, or anonymous sign-in is still switched off. Both are one-time
        // setup steps, and both look identical from inside the app, so say so.
        onError?.(
          err.code === 'permission-denied'
            ? "Firestore rejected the request. Check that firestore.rules is published and anonymous sign-in is on (docs/SETUP.md)."
            : "Couldn't reach your pantry.",
        );
      },
    );
  },

  async upsertItem(_uid, input) {
    return upsertItem(normalizeConfidence(input));
  },

  async upsertMany(_uid, inputs) {
    // One writeBatch commit, not N round-trips: a shelf photo can produce fifteen items,
    // and a half-applied pantry if the tab closes midway is worse than none.
    return batchUpsertItems(inputs.map(normalizeConfidence));
  },

  async deleteItem(_uid, key) {
    await removeItem(key);
  },

  async renameItem(_uid, previousKey, input) {
    // Not a patch: the doc id derives from the key, and the rules freeze `key` on update,
    // so shared does write-new-then-delete-old. See renameItem in shared/inventory.ts.
    return renameItem(previousKey, normalizeConfidence(input));
  },

  async has(_uid, key) {
    return has(key);
  },

  async getAllKeys() {
    return getAllKeys();
  },

  async loadSample() {
    // Upsert-by-key, so seeding twice is a no-op rather than fifteen duplicates.
    await batchUpsertItems(SAMPLE.map((s) => ({ ...s, addedVia: 'manual' as const })));
  },

  async clearAll() {
    // Scoped to the signed-in user by construction -- getAllKeys only ever returns keys
    // this uid owns, and the rules would reject anything else.
    const keys = await getAllKeys();
    await Promise.all(keys.map((key) => removeItem(key)));
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Firestore unless you explicitly ask for the stub. Vite inlines this at build time, so
 * the unused implementation is dropped from the production bundle.
 */
export const pantry: PantryStore =
  import.meta.env.VITE_PANTRY === 'local' ? localPantry : firestorePantry;
