/**
 * ⭐ The data contract. All three teams speak in items, and they only interoperate if the
 * shape matches. See CLAUDE.md -- this file is the agreement, not one team's preference.
 *
 * Adding a `Unit` or `Category` value is fine. Changing or removing one breaks the other
 * two teams, so announce it first.
 */
import type { Timestamp } from 'firebase/firestore';

export type Unit =
  | 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l'
  | 'tsp' | 'tbsp' | 'cup' | 'clove' | 'can' | 'pkg';

export type Category =
  | 'produce' | 'dairy' | 'meat' | 'seafood' | 'bakery'
  | 'pantry' | 'canned' | 'frozen' | 'spices'
  | 'beverages' | 'other';

/**
 * A branded string. Only normalizeKey() can produce one.
 *
 * The brand is doing real work: because ItemKey is not assignable from a plain string,
 * passing an un-normalized value where a key belongs is a compile error. "Always call
 * normalizeKey()" stops being a convention people forget and becomes something the
 * compiler enforces.
 */
export type ItemKey = string & { readonly __brand: unique symbol };

export interface Item {
  /** Normalized identity -- how items match ACROSS apps. The join column of the product. */
  key: ItemKey;
  /** Display text, whatever the human or the site called it. */
  name: string;
  category: Category;
  quantity?: number | null;
  unit?: Unit | null;
}

// --- Inventory -------------------------------------------------------------------------

export type StorageLocation = 'pantry' | 'fridge' | 'freezer';
export type AddedVia = 'manual' | 'photo' | 'barcode' | 'grocery';

/**
 * Presence-based: we track WHETHER you have something, not how much. `quantity` and `unit`
 * stay available for manual entry, but nothing in the app depends on them.
 */
export interface InventoryItem {
  key: ItemKey;
  /**
   * Added by the Inventory team for per-user security rules (anonymous auth).
   * Additive to the CLAUDE.md contract -- announced, nothing else changed.
   */
  userId: string;
  name: string;
  category: Category;
  location: StorageLocation;
  addedVia: AddedVia;
  /** 0-1, only meaningful when addedVia === 'photo'. */
  confidence?: number | null;
  quantity?: number | null;
  unit?: Unit | null;
  upc?: string | null;
  expiresAt?: Timestamp | null;
  updatedAt: Timestamp;
}

/**
 * What a caller supplies to the inventory data layer.
 * `key` is derived from `name` when omitted; `userId` and `updatedAt` are set by the layer.
 */
export type InventoryItemInput =
  Omit<InventoryItem, 'key' | 'userId' | 'updatedAt'> & { key?: ItemKey };

// --- Grocery ---------------------------------------------------------------------------

/** `groceries` is live. Extend it additively so today's app keeps working. */
export interface GroceryItem {
  name: string;
  checked: boolean;
  createdAt: Timestamp;
  key?: ItemKey;
  quantity?: number | null;
  unit?: Unit | null;
  category?: Category;
  source?: 'manual' | 'recipe' | 'inventory';
  /** Trace + de-dupe. */
  sourceId?: string | null;
  storeProductId?: string | null;
}

// --- Recipe ----------------------------------------------------------------------------

export interface Recipe {
  title: string;
  sourceUrl?: string;
  imageUrl?: string;
  servings?: number;
  ingredients: Item[];
  steps: string[];
  tags: string[];
  createdBy: string;
  createdAt: Timestamp;
}

// --- User ------------------------------------------------------------------------------

export interface UserPrefs {
  storeLocationId?: string;
  storeName?: string;
  zip?: string;
}

// --- Shelf photo analysis (Inventory bonus) ----------------------------------------------

/**
 * One item the vision model believes it saw on a shelf. A SUGGESTION, not a fact --
 * candidates go to the review grid, never straight to Firestore.
 */
export interface ShelfCandidate {
  /** Already normalized server-side, so the photo path matches every other path. */
  key: ItemKey;
  /** Generic name for matching ("black beans"), brand kept separate. */
  name: string;
  brand?: string | null;
  category: Category;
  /** 0-1. The review grid pre-checks high-confidence items only. */
  confidence: number;
  note?: string | null;
}

/** Response shape of POST /analyzeShelf. */
export interface AnalyzeShelfResponse {
  items: ShelfCandidate[];
  /** The pinned model that produced the candidates, for traceability. */
  model: string;
}
