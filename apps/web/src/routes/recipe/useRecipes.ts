/**
 * The live cookbook: every doc in `recipes`, newest first.
 *
 * Sorting happens here rather than in an orderBy because `createdAt` is
 * serverTimestamp(), which reads back as null on the local echo before the server
 * round-trips. A just-saved recipe would otherwise jump position as the real timestamp
 * lands; treating a null as "right now" pins it to the top where the cook expects it.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db, type Recipe } from '@grocery/shared';

/** A recipe plus its Firestore doc id, which is the tile's link target. */
export type RecipeRow = Recipe & { id: string };

export interface UseRecipes {
  rows: RecipeRow[];
  loading: boolean;
  error: string | null;
}

/** Millis for sorting. A pending write has no server time yet, so it sorts as newest. */
function createdMillis(createdAt: Timestamp | null | undefined): number {
  return createdAt ? createdAt.toMillis() : Number.MAX_SAFE_INTEGER;
}

export function useRecipes(): UseRecipes {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'recipes'),
      (snap) => {
        const next = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Recipe),
        }));
        next.sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt));
        setRows(next);
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
