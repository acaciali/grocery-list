/**
 * Where the pantry lives *for now*: entirely in the browser.
 *
 * ⭐ THIS IS STUB DATA. No Firebase, no auth, no network, no setup. Open the Pantry tab on
 * a fresh clone and it just works, pre-filled with a realistic pantry so grouping, search,
 * filtering and the photo review flow all have something real to act on.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────
 * 🔌 BACKEND: THIS IS THE SEAM. Swapping to Firestore means writing one more object that
 * implements PantryStore and exporting that as `pantry` instead. No component changes --
 * nothing in the UI knows or cares which implementation it is talking to.
 *
 * The Firestore implementation is already written and typechecked in
 * `packages/shared/src/inventory.ts`. Its function signatures line up with this interface
 * one-to-one on purpose, so the adapter is a dozen lines of forwarding. That module is
 * also where Grocery gets `has()` for I2 and Recipe gets `getAllKeys()` for I5, which is
 * why it lives in shared rather than here.
 * ───────────────────────────────────────────────────────────────────────────────────────
 */
import { Timestamp } from 'firebase/firestore';
import {
  normalizeKey,
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
  subscribe(uid: string, onRows: (rows: InventoryRow[]) => void): () => void;
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

/** Stored shape: same as InventoryItem but with a plain number for the timestamp, since
 *  a Firestore Timestamp does not survive JSON.stringify. */
type StoredItem = Omit<InventoryItem, 'updatedAt' | 'expiresAt'> & { updatedAt: number };

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
  };
}

function toStored(input: InventoryItemInput): StoredItem {
  const key = input.key ?? normalizeKey(input.name);
  return {
    key,
    userId: LOCAL_UID,
    name: input.name.trim(),
    category: input.category,
    location: input.location,
    addedVia: input.addedVia,
    confidence: input.addedVia === 'photo' ? (input.confidence ?? null) : null,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    upc: input.upc ?? null,
    updatedAt: Date.now(),
  };
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

export const pantry: PantryStore = {
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
