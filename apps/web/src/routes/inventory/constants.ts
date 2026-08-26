/** Display metadata for the Inventory surface. Values come from the shared contract. */
import type { AddedVia, Category, StorageLocation, Unit } from '@grocery/shared';

/** Order matters -- this is the order sections appear in the grouped list. */
export const LOCATIONS: readonly StorageLocation[] = ['pantry', 'fridge', 'freezer'];

export const LOCATION_META: Record<StorageLocation, { label: string; emoji: string }> = {
  pantry: { label: 'Pantry', emoji: '🥫' },
  fridge: { label: 'Fridge', emoji: '🧊' },
  freezer: { label: 'Freezer', emoji: '❄️' },
};

/** Every Category in the contract. Adding one here is display-only; add it to types.ts too. */
export const CATEGORIES: readonly Category[] = [
  'produce', 'dairy', 'meat', 'seafood', 'bakery',
  'pantry', 'canned', 'frozen', 'spices', 'beverages', 'other',
];

export const CATEGORY_LABEL: Record<Category, string> = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Meat',
  seafood: 'Seafood',
  bakery: 'Bakery',
  pantry: 'Pantry',
  canned: 'Canned',
  frozen: 'Frozen',
  spices: 'Spices',
  beverages: 'Beverages',
  other: 'Other',
};

/**
 * Shown subtly on each row so a user can tell an AI guess from something they typed.
 * That distinction matters: a wrong photo-sourced row silently breaks I2 and I5, so it
 * needs to stay visibly different from a row a human vouched for.
 */
export const ADDED_VIA_META: Record<AddedVia, { label: string; emoji: string }> = {
  manual: { label: 'Typed', emoji: '✍️' },
  photo: { label: 'From a photo', emoji: '📸' },
  barcode: { label: 'Scanned', emoji: '🏷️' },
  grocery: { label: 'From groceries', emoji: '🛒' },
};

/**
 * One-tap add for the things people restock constantly. Location is the default, not a
 * rule -- the row is editable the moment it lands.
 */
export const STAPLES: readonly { name: string; category: Category; location: StorageLocation }[] = [
  { name: 'Milk', category: 'dairy', location: 'fridge' },
  { name: 'Eggs', category: 'dairy', location: 'fridge' },
  { name: 'Butter', category: 'dairy', location: 'fridge' },
  { name: 'Bread', category: 'bakery', location: 'pantry' },
  { name: 'Rice', category: 'pantry', location: 'pantry' },
  { name: 'Pasta', category: 'pantry', location: 'pantry' },
  { name: 'Olive oil', category: 'pantry', location: 'pantry' },
  { name: 'Onions', category: 'produce', location: 'pantry' },
  { name: 'Garlic', category: 'produce', location: 'pantry' },
  { name: 'Chicken breast', category: 'meat', location: 'freezer' },
];

/**
 * ⭐ Above this, a detection is pre-checked in the review grid. Below it, the card still
 * appears but starts unchecked, so accepting a bad guess takes a deliberate tap.
 *
 * Never auto-save either group. Anthropic's docs warn against using Claude for tasks
 * needing perfect precision without human oversight, and bad pantry data is worse than
 * no pantry data. The review screen is not polish.
 */
export const HIGH_CONFIDENCE = 0.7;

/**
 * Every Unit in the contract, for the optional quantity field. Inventory is presence-based
 * so nothing here is load-bearing -- it exists because "2 cans" is genuinely useful to
 * write down, not because any feature reads it.
 */
export const UNITS: readonly Unit[] = [
  'g', 'kg', 'oz', 'lb', 'ml', 'l',
  'tsp', 'tbsp', 'cup', 'clove', 'can', 'pkg',
];
