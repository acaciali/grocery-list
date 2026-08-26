/**
 * 🥫➜🍳 The pure half of "Cook from my pantry": the copy the cards read out, and the plan
 * behind the "add what's missing" button.
 *
 * Split out from the view for the same reason `planAdds` is split out of the grocery write
 * -- the arithmetic is checkable without React, without Firestore, and without a browser.
 * apps/web has vitest (node env), and cookFromPantry.test.ts points at this file.
 *
 * Scoring is NOT here. That is `packages/shared/src/matching.ts`, which owns what "have"
 * and "missing" mean; nothing in this file re-decides it.
 */
import type { AddSummary } from '../grocery/addFromRecipe';
import type { Item, ItemKey, MatchedIngredient, RecipeMatch } from '@grocery/shared';

/** The narrow shape these helpers need, so tests do not have to build a whole RecipeRow. */
type Scored = Pick<RecipeMatch<unknown>, 'have' | 'missing' | 'haveCount' | 'totalCount'>;

/**
 * "You have 5 of 7" -- counts, not a percentage.
 *
 * recipe.md is explicit about this: "You have 5 of 7 — you need: cumin, lime" reads better
 * than any percentage. 71% is a number you have to do arithmetic on to act on; "2 to buy"
 * is the decision itself.
 */
export function haveLabel(match: Scored): string {
  return `You have ${match.haveCount} of ${match.totalCount}`;
}

/**
 * "cumin, lime" -- and "cumin, lime and 3 more" once the list stops fitting on a card.
 *
 * Names rather than keys: `ground-black-pepper` is our identifier, not a shopping list.
 */
export function namesList(items: readonly { name: string }[], limit = 3): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, limit).map((item) => item.name);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

/**
 * The ingredients counted as "have" only because they are staples nobody logs.
 *
 * ⚠️ The reason this is a separate list rather than folded into the badge: the count is a
 * useful default, but *telling a cook their pantry holds something they never logged* is a
 * claim the screen cannot back up. Same rule as the shelf-photo review grid -- a guess gets
 * rendered as a guess. The view marks these visually; this function is what it marks.
 */
export function assumedIngredients(match: Scored): Item[] {
  return match.have
    .filter((entry: MatchedIngredient) => entry.via === 'assumed')
    .map((entry) => entry.item);
}

/** One recipe's share of a multi-recipe shopping run. */
export interface MissingGroup {
  recipeId: string;
  items: Item[];
}

type Attributable = { recipe: { id: string }; missing: Item[] };

/**
 * ⭐ Split the missing ingredients of a selection across the recipes that need them, so the
 * same thing is bought once.
 *
 * This is `missingAcross()`'s de-dupe with the attribution kept: first recipe to need cumin
 * owns the cumin. Attribution is load-bearing rather than cosmetic -- Grocery's
 * `addRecipeIngredients(recipeId, items)` stamps `source: 'recipe'` and `sourceId` on every
 * row it writes, and PLAN.md wants those rows traceable back to the recipe that put them
 * there. A single combined write would have to pick one recipe id and lie about the rest.
 *
 * Groups are disjoint by key, so calling Grocery once per group cannot double-count: two
 * recipes both wanting cumin produce one cumin row, not a row with quantity 2.
 *
 * Empty groups are dropped -- a selected recipe you have everything for is not a write.
 */
export function planMissingByRecipe(matches: readonly Attributable[]): MissingGroup[] {
  const claimed = new Set<ItemKey>();
  const groups: MissingGroup[] = [];

  for (const match of matches) {
    const items: Item[] = [];
    for (const item of match.missing) {
      // A keyless ingredient cannot be de-duped -- every one of them is indistinguishable
      // from the next -- so it is kept rather than collapsed. This deliberately differs
      // from shared's missingAcross(), whose Map keys every unkeyed item as `undefined`
      // and so keeps only the first. Dropping a real ingredient from a shopping list is
      // the worse failure. Only reachable for a hand-edited document: toRow() derives a
      // key for everything it reads.
      if (!item.key) {
        items.push(item);
        continue;
      }
      if (claimed.has(item.key)) continue;
      claimed.add(item.key);
      items.push(item);
    }
    if (items.length > 0) groups.push({ recipeId: match.recipe.id, items });
  }

  return groups;
}

/** How many rows the button is about to touch, for an honest label before you press it. */
export function countMissing(groups: readonly MissingGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/**
 * "Added 6, topped up 2 already on your list." -- what actually happened, rather than a
 * flat "Added to list". A merge is the surprising outcome, so it gets named.
 *
 * Takes several summaries because a selection writes once per recipe (see
 * planMissingByRecipe). The cook made one decision, so they get one sentence.
 */
export function summarizeAdds(summaries: readonly AddSummary[]): string {
  const added = summaries.reduce((total, s) => total + s.added, 0);
  const merged = summaries.reduce((total, s) => total + s.merged, 0);

  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added}`);
  if (merged > 0) parts.push(`topped up ${merged} already on your list`);
  return parts.length === 0 ? 'Nothing to add' : `${parts.join(', ')}.`;
}
