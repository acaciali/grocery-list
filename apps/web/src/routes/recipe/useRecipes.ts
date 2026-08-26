/**
 * The live cookbook: every doc in `recipes`, newest first.
 *
 * ⭐ The read itself belongs to `packages/shared/src/recipes.ts`, not here. This used to be
 * its own onSnapshot with a `doc.data() as Recipe` cast, and that cast was a lie for about
 * half the collection: the vanilla pages (recipes.html / recipe.html) were never ported and
 * still write `name` instead of `title`, `minutes` instead of `totalMinutes`, and
 * ingredients with no `key` at all. A legacy recipe rendered here as a blank-titled tile,
 * and -- because `key` is the entire basis of pantry matching -- was unmatchable.
 *
 * `subscribeToRecipes` runs every document through `toRow()`, which adapts the old shape
 * onto the contract on read. One file knows the legacy shape exists; this one does not.
 *
 * Sorting stays here rather than in an orderBy because `createdAt` is serverTimestamp(),
 * which reads back as null on the local echo before the server round-trips. A just-saved
 * recipe would otherwise jump position as the real timestamp lands.
 */
import { useEffect, useState } from 'react';
import { subscribeToRecipes, type RecipeRow } from '@grocery/shared';
import type { Timestamp } from 'firebase/firestore';

/**
 * Re-exported so this module stays the Recipe surface's one import for "a recipe plus its
 * doc id", and callers didn't have to change when the read moved into shared.
 */
export type { RecipeRow };

export interface UseRecipes {
  rows: RecipeRow[];
  loading: boolean;
  error: string | null;
}

/**
 * Millis for sorting. `subscribeToRecipes` asks for estimated server timestamps, so a
 * pending write already sorts as newest; the null branch covers a legacy document that
 * never had a `createdAt` field at all, which sorts oldest rather than jumping the queue.
 */
function createdMillis(createdAt: Timestamp | null | undefined): number {
  return createdAt ? createdAt.toMillis() : 0;
}

export function useRecipes(): UseRecipes {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToRecipes(
      (next) => {
        // Copy before sorting: the array is shared's to hand out, not ours to mutate.
        setRows([...next].sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt)));
        setError(null);
        setLoading(false);
      },
      // A listen can fail *after* it succeeded (rules edited, network lost), so this
      // clears `loading` rather than assuming a first snapshot already did.
      (err) => {
        console.error(err);
        setError("Couldn't load your recipes.");
        setLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  return { rows, loading, error };
}
