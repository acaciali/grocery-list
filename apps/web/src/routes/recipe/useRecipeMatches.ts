/**
 * 🥫➜🍳 The live "what can I cook?" feed: the cookbook and the pantry, ranked one against
 * the other, re-ranking the moment either changes.
 *
 * ⭐ TWO SUBSCRIPTIONS, NOT `findRecipeMatches()`. Shared ships a one-shot version that
 * does both reads in parallel and ranks once -- right for a script or a button press, wrong
 * for a screen. Adding milk on the Pantry tab has to move this list *while you are looking
 * at it*; that live re-rank is the whole demo. So: two live feeds, and `matchRecipes()` in
 * a memo over the pair.
 *
 * The pantry comes from `useInventory()`, which is the `pantry` store from
 * routes/inventory/pantryStore.ts. Deliberately NOT `subscribeToInventory()` directly --
 * the store is the seam that makes VITE_PANTRY=local work, and reaching past it would mean
 * this one screen is the only one that cannot be developed without a Firebase project.
 *
 * Matching itself is pure and lives in `packages/shared/src/matching.ts`. Nothing about
 * ranking is decided here.
 */
import { useMemo } from 'react';
import {
  matchRecipes,
  type ItemKey,
  type MatchOptions,
  type MatchSort,
  type RecipeMatch,
  type RecipeRow,
} from '@grocery/shared';
import { useInventory } from '../inventory/useInventory';
import { useRecipes } from './useRecipes';

export interface UseRecipeMatchesOptions {
  /** Default `'missing'` -- fewest things to buy, which is what a cook is asking. */
  sort?: MatchSort;
  /** Pass `COMMON_STAPLES` to assume salt/pepper/water. Counted, but tagged `assumed`. */
  assumedKeys?: readonly ItemKey[];
  /** Drop recipes sharing fewer than this many ingredients with the pantry. */
  minMatches?: number;
}

export interface UseRecipeMatches {
  /** Ranked. Filters beyond `minMatches` are the view's business -- see the note below. */
  matches: RecipeMatch<RecipeRow>[];
  /** Recipes in the cookbook, BEFORE ranking or filtering. Tells apart the empty states. */
  recipeCount: number;
  /** Distinct keys in the pantry, BEFORE ranking. Zero means "go add something", not "no matches". */
  pantryCount: number;
  /** True until BOTH feeds have delivered a first snapshot. */
  loading: boolean;
  error: string | null;
}

/**
 * `maxMissing` is deliberately absent from the options above.
 *
 * The view needs to know how many recipes sit just outside the current filter, so it can
 * offer to widen it instead of showing an empty screen (recipe.md, frontend step 4).
 * Filtering here would throw that number away. `missingCount` is already on every match, so
 * the view filters a ranked array -- which preserves order and costs nothing.
 */
export function useRecipeMatches({
  sort = 'missing',
  assumedKeys,
  minMatches,
}: UseRecipeMatchesOptions = {}): UseRecipeMatches {
  const { rows: recipes, loading: recipesLoading, error: recipesError } = useRecipes();
  const { rows: pantryRows, loading: pantryLoading, error: pantryError } = useInventory();

  /**
   * The Set is built once per (pantry, options) change rather than per recipe: `matchRecipes`
   * takes any iterable and would otherwise rebuild it on every call.
   */
  const matches = useMemo(() => {
    const pantryKeys = new Set(pantryRows.map((row) => row.key));
    const options: MatchOptions = { sort, assumedKeys, minMatches };
    return matchRecipes(recipes, pantryKeys, options);
  }, [recipes, pantryRows, sort, assumedKeys, minMatches]);

  return {
    matches,
    recipeCount: recipes.length,
    // Distinct, because the pantry is keyed by doc id = key and two rows cannot share one.
    pantryCount: pantryRows.length,
    // Both, not either: ranking against a pantry that has not arrived yet would render a
    // "you have 0 of 7" screen for a beat and then reshuffle under the cook's eyes.
    loading: recipesLoading || pantryLoading,
    /**
     * A failed pantry listen never delivers a first snapshot, and both underlying hooks
     * pass an onError precisely so `loading` still clears -- otherwise this screen waits
     * forever for something that is not coming.
     *
     * Reported rather than swallowed. An unreadable pantry ranks every recipe as "you have
     * none of this", which is a confident wrong answer; the view shows the error instead of
     * the list.
     */
    error: recipesError ?? pantryError,
  };
}
