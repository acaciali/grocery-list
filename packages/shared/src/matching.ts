/**
 * 🍳🥫 Pantry matching -- "what can I cook with what I already have?"
 *
 * This closes the last arrow in the loop from CLAUDE.md: INVENTORY ──► RECIPE. It is pure
 * and synchronous on purpose: no Firestore import, no network, no clock. Give it recipes
 * and a set of pantry keys, get back a ranked list. That makes it trivially testable, and
 * it means the same function can rank a Firestore snapshot in the browser or a candidate
 * list inside a Cloud Function without changing a line.
 *
 * ⭐ MATCHING IS EXACT KEY EQUALITY, DELIBERATELY.
 *
 * `ItemKey` is the join column of the whole product, and normalizeKey() already does the
 * hard part -- a recipe's "2 cups whole milk" and the pantry's "Whole Milk" both land on
 * `milk`, so they match here for free. What this file does NOT do is invent a second,
 * fuzzier notion of sameness on top (substring hits, token overlap, brand stripping).
 *
 * That is not laziness, it is the same call items.ts makes at the top of the file: brand
 * and near-match handling is an OPEN QUESTION pending the Phase 0 all-hands. If matching
 * grew its own looser rules now, "does my pantry have this?" would quietly get two
 * different answers depending on whether Grocery asked (via has()) or Recipe asked (via
 * this file) -- which is exactly the schema drift the shared contract exists to prevent.
 * When normalizeKey() gets smarter, every caller including this one gets smarter with it.
 */
import { normalizeKey } from './items.js';
import type { Item, ItemKey } from './types.js';

/**
 * How an ingredient came to be counted as "have".
 *
 * `assumed` exists so the UI can never overclaim. Counting salt as present is a useful
 * default (see COMMON_STAPLES); *telling the cook it is in their pantry* when they never
 * logged it is a lie the screen would have no way to catch. Same count, different badge.
 */
export type MatchSource = 'pantry' | 'assumed';

export interface MatchedIngredient {
  item: Item;
  via: MatchSource;
}

/**
 * One recipe scored against one pantry.
 *
 * Generic in the recipe type so the caller keeps whatever it passed in -- a `Recipe`, or a
 * `RecipeRow` with its Firestore doc id still attached for the detail link. Nothing here
 * needs to know which.
 */
export interface RecipeMatch<R> {
  recipe: R;
  /** In the recipe's own ingredient order, so the UI can render the list as written. */
  have: MatchedIngredient[];
  missing: Item[];
  haveCount: number;
  missingCount: number;
  /** Distinct ingredient keys -- see the de-dupe note in matchRecipe(). */
  totalCount: number;
  /** haveCount / totalCount, 0..1. Zero when the recipe has no ingredients. */
  coverage: number;
}

/**
 * Three honest answers to "which recipes match best", because there is no single one:
 *
 * - `missing`   fewest things to buy first. Answers "what can I cook tonight?", which is
 *               the question someone standing in their kitchen is actually asking.
 * - `coverage`  highest fraction of the recipe covered. Fairer across recipe sizes.
 * - `matches`   most ingredients matched, in absolute count. The literal reading of "the
 *               most ingredients" -- but it favours long recipes, so a 20-ingredient curry
 *               you have 15 of outranks a 3-ingredient pasta you have all of.
 *
 * `missing` is the default for that last reason.
 */
export type MatchSort = 'missing' | 'coverage' | 'matches';

export interface MatchOptions {
  /**
   * Keys to treat as present without being in the pantry -- pass COMMON_STAPLES for the
   * usual suspects. They count toward `haveCount` but are tagged `via: 'assumed'`.
   */
  assumedKeys?: Iterable<ItemKey>;
  /** Default `'missing'`. */
  sort?: MatchSort;
  /** Keep only recipes needing at most this many more items. `0` = cookable right now. */
  maxMissing?: number;
  /** Drop recipes sharing fewer than this many ingredients. `1` hides the no-overlap tail. */
  minMatches?: number;
  /** Truncate after sorting. */
  limit?: number;
}

/**
 * Seasoning-tier things nobody logs in a pantry app but everybody has. Without these, a
 * recipe calling for salt and pepper reads as "2 items missing" and the whole ranking
 * turns to noise -- every recipe is penalised by the same two items it should not be.
 *
 * Kept deliberately short. Butter, sugar, flour and oils are all things you can genuinely
 * run out of mid-recipe, so they stay off the list and get logged like real items.
 *
 * Built through normalizeKey() rather than hand-written as key strings, so the list cannot
 * drift out of sync with the normalizer. If normalizeKey() changes how it treats "black
 * pepper", these follow automatically instead of silently ceasing to match.
 *
 * ⚠️ The same seasoning appears several times because normalizeKey() keeps words it cannot
 * safely drop. "freshly ground black pepper" normalizes to `ground-black-pepper`, NOT
 * `black-pepper` -- and "ground" must stay a real word, or "ground beef" would collapse
 * into "beef". Listing the spellings a recipe actually uses is the cheap fix; the
 * expensive one is teaching the normalizer about near-matches, which is the open question
 * at the top of items.ts. Add a spelling here when a recipe surprises you.
 */
export const COMMON_STAPLES: readonly ItemKey[] = [
  'salt',
  'kosher salt',
  'sea salt',
  'table salt',
  'pepper',
  'black pepper',
  'ground pepper',
  'ground black pepper',
  'cracked black pepper',
  'white pepper',
  // One line, two ingredients -- keys as the compound `salt-pepper`. Splitting compound
  // lines is parseIngredientLine()'s job, not the matcher's; until it exists, assuming
  // this one is exactly as safe as assuming salt.
  'salt and pepper',
  'salt and black pepper',
  'water',
  'ice',
].map(normalizeKey);

/** The minimum a recipe needs to look like for scoring. */
interface Scorable {
  title: string;
  ingredients: Item[];
}

/**
 * Score one recipe. Exported because a detail screen wants exactly this for the recipe
 * already on screen, without ranking the whole cookbook to get it.
 *
 * ⚠️ Counts are over DISTINCT keys. A recipe listing "1 cup milk" for the sauce and
 * "2 tbsp milk" for the glaze is two lines but one ingredient you either have or don't --
 * counting both would double-penalise a recipe you are only one shopping item away from,
 * and would let coverage disagree with itself. First mention wins for display.
 */
export function matchRecipe<R extends Scorable>(
  recipe: R,
  pantryKeys: ReadonlySet<ItemKey>,
  assumedKeys: ReadonlySet<ItemKey> = new Set(),
): RecipeMatch<R> {
  const have: MatchedIngredient[] = [];
  const missing: Item[] = [];
  const seen = new Set<ItemKey>();
  /**
   * Ingredients with no key at all. They cannot be de-duped (every one of them is
   * indistinguishable from the next) so they are counted separately rather than through
   * `seen` -- which would otherwise collapse a whole keyless recipe into a single item.
   */
  let unkeyed = 0;

  for (const item of recipe.ingredients ?? []) {
    if (!item) continue;

    // A keyless ingredient is one we cannot match, so it counts as missing. Silently
    // dropping it would inflate coverage and tell the cook they can make something they
    // cannot. Reachable for documents written before the shared contract existed --
    // recipes.ts adapts those on read, and this is the seatbelt for anything that slips
    // past, including a hand-edited document in the Firestore console.
    if (!item.key) {
      missing.push(item);
      unkeyed += 1;
      continue;
    }

    if (seen.has(item.key)) continue;
    seen.add(item.key);

    // Pantry wins over assumed: if you logged the salt, say so.
    if (pantryKeys.has(item.key)) have.push({ item, via: 'pantry' });
    else if (assumedKeys.has(item.key)) have.push({ item, via: 'assumed' });
    else missing.push(item);
  }

  const totalCount = seen.size + unkeyed;
  return {
    recipe,
    have,
    missing,
    haveCount: have.length,
    missingCount: missing.length,
    totalCount,
    coverage: totalCount === 0 ? 0 : have.length / totalCount,
  };
}

/**
 * A recipe with no ingredients scores missingCount 0 and would top a `missing` sort while
 * matching nothing at all. It is a half-finished draft, not tonight's dinner, so it is
 * pushed below everything else regardless of sort mode.
 */
function emptiness(match: RecipeMatch<unknown>): number {
  return match.totalCount === 0 ? 1 : 0;
}

function comparator(sort: MatchSort) {
  return (a: RecipeMatch<Scorable>, b: RecipeMatch<Scorable>): number => {
    const empty = emptiness(a) - emptiness(b);
    if (empty !== 0) return empty;

    if (sort === 'matches') {
      if (a.haveCount !== b.haveCount) return b.haveCount - a.haveCount;
      if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    } else if (sort === 'coverage') {
      if (a.coverage !== b.coverage) return b.coverage - a.coverage;
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
    } else {
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
      if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    }

    if (a.haveCount !== b.haveCount) return b.haveCount - a.haveCount;
    // Last resort so the order is stable across renders. Firestore hands back documents in
    // no guaranteed order, so without this two equally-good recipes can swap places on
    // every snapshot and the list visibly jitters.
    //
    // ?? '' because `title` is only required by the TYPE. A document written by the
    // pre-port vanilla app calls it `name`, so title is undefined at runtime and two such
    // recipes tie all the way down to here -- which threw a TypeError and took the whole
    // page with it. Types describe our writers, not the collection's history.
    return (a.recipe.title ?? '').localeCompare(b.recipe.title ?? '');
  };
}

/**
 * ⭐ The entry point. Rank a cookbook against a pantry.
 *
 * ```ts
 * const matches = matchRecipes(recipes, pantryKeys, {
 *   assumedKeys: COMMON_STAPLES,
 *   minMatches: 1,
 * });
 * ```
 *
 * `pantryKeys` takes any iterable, so `getAllKeys()`'s array and a Set built from a live
 * snapshot both work. Never mutates its input.
 */
export function matchRecipes<R extends Scorable>(
  recipes: readonly R[],
  pantryKeys: Iterable<ItemKey>,
  options: MatchOptions = {},
): RecipeMatch<R>[] {
  const { assumedKeys, sort = 'missing', maxMissing, minMatches, limit } = options;

  const pantry = pantryKeys instanceof Set ? (pantryKeys as Set<ItemKey>) : new Set(pantryKeys);
  const assumed = assumedKeys ? new Set(assumedKeys) : new Set<ItemKey>();

  let matches = recipes.map((recipe) => matchRecipe(recipe, pantry, assumed));

  if (maxMissing !== undefined) matches = matches.filter((m) => m.missingCount <= maxMissing);
  if (minMatches !== undefined) matches = matches.filter((m) => m.haveCount >= minMatches);

  matches.sort(comparator(sort));

  return limit === undefined ? matches : matches.slice(0, limit);
}

/**
 * Every ingredient you'd have to buy to cook this selection, de-duped across recipes and
 * ready to hand to Grocery for I1. Two recipes both wanting cumin is one line on the list.
 *
 * Returns `Item`s straight from the recipes, so quantity and unit survive -- the caller
 * decides whether to keep them, and first mention wins when two recipes disagree.
 */
export function missingAcross(matches: readonly RecipeMatch<unknown>[]): Item[] {
  const byKey = new Map<ItemKey, Item>();
  for (const match of matches) {
    for (const item of match.missing) {
      if (!byKey.has(item.key)) byKey.set(item.key, item);
    }
  }
  return [...byKey.values()];
}
