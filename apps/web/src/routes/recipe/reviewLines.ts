/**
 * The decisions behind the add-to-groceries sheet, kept apart from the rendering so the
 * rules are checkable on their own: what you already own, what has gone off, and what
 * therefore starts ticked.
 *
 * Same split as routes/grocery/addFromRecipe.ts -- pure logic in one file, the write (or
 * the render) in another.
 */
import type { InventoryItem, Item } from '@grocery/shared';
// Cross-route import: what counts as "expired" is Inventory's meaning to define, and this
// sheet is I1, which PLAN.md assigns to two teams jointly. Better a shared definition than
// a second threshold here that drifts from the pantry's own badges.
import { describeExpiry, type ExpiryNote } from '../inventory/dates';
import { safeKey } from '../grocery/addFromRecipe';

/** One ingredient as the sheet holds it. */
export interface Line {
  /** Index-based: two lines can share a key ("2 cups milk", "1 cup milk"). */
  id: number;
  item: Item;
  /** I2: this key is already in the pantry, so it starts unticked. */
  inPantry: boolean;
  /** The pantry row's expiry, when it has one. Null for "no date recorded". */
  expiry: ExpiryNote | null;
  /** Already on the grocery list -- adding will bump that row, not make a second one. */
  onList: boolean;
  checked: boolean;
}

/**
 * ⭐ In the pantry, but not in a state you can cook with.
 *
 * Owning something and being able to use it are different questions, and a presence check
 * only answers the first: a jar of olive oil that expired in March passes `has(key)` and
 * fails the recipe. These rows go to the top of the sheet for review.
 */
export function needsReview(line: Line): boolean {
  return line.inPantry && line.expiry?.urgent === true;
}

/**
 * Build the sheet's lines from what the pantry and the list say.
 *
 * `pantry` is null when it could not be read. Everything then starts ticked: failing to
 * check is not evidence that you own nothing, and the sheet says as much.
 */
export function buildLines(
  ingredients: Item[],
  pantry: Map<string, InventoryItem> | null,
  listKeys: Set<string>,
): Line[] {
  return ingredients.map((item, index) => {
    const key = safeKey(item.name);
    const owned = key === undefined || pantry === null ? undefined : pantry.get(key);
    return {
      id: index,
      item,
      inPantry: owned !== undefined,
      expiry: describeExpiry(owned?.expiresAt),
      onList: key !== undefined && listKeys.has(key),
      // Unticked because you own it -- expiry does not change that. It changes how loudly
      // the row says so, which is the review section's job, not the checkbox's.
      checked: owned === undefined,
    };
  });
}

/** The three groups the sheet renders, in the order it renders them. */
export function groupLines(lines: Line[]): {
  review: Line[];
  missing: Line[];
  owned: Line[];
} {
  return {
    review: lines.filter(needsReview),
    missing: lines.filter((line) => !line.inPantry),
    owned: lines.filter((line) => line.inPantry && !needsReview(line)),
  };
}
