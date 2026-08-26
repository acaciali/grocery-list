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
  | 'tsp' | 'tbsp' | 'cup' | 'clove' | 'can' | 'pkg'
  // Grocery additions (additive, announced): how people actually write list quantities.
  // The original set is recipe-shaped; "2 gal milk" and "a dozen eggs" had no home.
  | 'gal' | 'each' | 'dozen' | 'bunch' | 'bag';

/**
 * The runtime companion to `Unit`, for populating unit dropdowns. Kept next to the type so
 * the two cannot drift: the annotation makes an unlisted or misspelled unit a compile error.
 */
export const UNITS: readonly Unit[] = [
  'g', 'kg', 'oz', 'lb', 'ml', 'l',
  'tsp', 'tbsp', 'cup', 'clove', 'can', 'pkg',
];

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
 * `key` is derived from `name` when omitted; `updatedAt` is set by the layer.
 */
export type InventoryItemInput =
  Omit<InventoryItem, 'key' | 'updatedAt'> & { key?: ItemKey };

// --- Grocery ---------------------------------------------------------------------------

/**
 * Where a list item stands on its way to a real store product. The list never blocks on
 * any of these -- an item is on the list the moment it's typed; this only tracks whether
 * the store leg of the trip is ready.
 */
export type MatchStatus =
  | 'unresolved'   // never attempted -- arrived via I1/I2, or added with no store connected
  | 'resolving'    // lookup in flight
  | 'matched'      // confident single product
  | 'ambiguous'    // several plausible candidates; needs a human pick
  | 'unavailable'  // right product, out of stock at this location
  | 'no_match'     // search returned nothing usable
  | 'not_sold'     // human said "stores don't sell this" -- sticky, never auto-retried
  | 'sent';        // pushed to the store cart

/** One product at one store, as returned by the store's search. */
export interface StoreProduct {
  productId: string;
  /** Kroger's cart-add endpoint takes UPC, not productId. Persist it or cart push dies. */
  upc: string;
  name: string;
  brand?: string | null;
  /** Display size string as the store gives it, e.g. "1 gal". */
  size?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  promoPrice?: number | null;
  stockLevel?: 'HIGH' | 'LOW' | 'TEMPORARILY_OUT_OF_STOCK' | null;
  category?: Category | null;
}

/**
 * A grocery item's link to a store product. Prices, stock, and availability are all
 * per-store, so `locationId` lives here: switching stores resets matches to 'unresolved'
 * rather than showing another store's prices. 'not_sold' is the one status that survives
 * a store switch -- it is a statement about the item, not the store.
 */
export interface StoreMatch {
  status: MatchStatus;
  locationId: string | null;
  product?: StoreProduct | null;
  /** Top candidates cached at resolve time so the picker opens without a round-trip. */
  candidates?: StoreProduct[];
  /** 0-1 resolver confidence; only meaningful when chosenBy === 'auto'. */
  confidence?: number | null;
  chosenBy?: 'user' | 'auto' | 'memory' | null;
  /**
   * Packages to put in the cart -- distinct from the list quantity. "2 lb chicken"
   * against a 1.5 lb package is 2 packages, not 2 lb.
   */
  cartQuantity?: number | null;
  resolvedAt?: Timestamp | null;
  sentAt?: Timestamp | null;
}

/** A store location, as returned by /findStores. */
export interface StoreLocation {
  locationId: string;
  name: string;
  address: string;
  chain?: string | null;
}

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
  /** Mirror of match.product.productId, kept so pre-match readers stay correct. */
  storeProductId?: string | null;
  match?: StoreMatch | null;
}

// --- Recipe ----------------------------------------------------------------------------

export interface Recipe {
  title: string;
  sourceUrl?: string;
  imageUrl?: string;
  servings?: number;
  /**
   * Durations in whole minutes. Stored as numbers rather than schema.org's ISO 8601
   * strings ("PT1H15M") so they sort and add without re-parsing; the import path converts.
   *
   * `totalMinutes` is its own field, not `prep + cook` -- resting, marinating and chilling
   * live in the gap, so deriving it would understate a lot of real recipes.
   */
  prepMinutes?: number;
  cookMinutes?: number;
  totalMinutes?: number;
  ingredients: Item[];
  steps: string[];
  tags: string[];
  /** Free-form cook's notes: swaps, provenance, what to serve it with. */
  notes?: string;
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
  /**
   * True when the items are a demo fixture rather than real model output. The UI must
   * say so -- a spoofed scan that looks real is how a demo becomes a lie.
   */
  stubbed?: boolean;
}
