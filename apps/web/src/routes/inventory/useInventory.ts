/**
 * The live pantry, from whatever `pantry` happens to be -- Firestore by default, the
 * browser stub under VITE_PANTRY=local. This file does not care which.
 */
import { useEffect, useState } from 'react';
import type { InventoryRow } from '@grocery/shared';
import { pantry } from './pantryStore';

export interface UseInventory {
  rows: InventoryRow[];
  uid: string | null;
  loading: boolean;
  error: string | null;
}

export function useInventory(): UseInventory {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // signIn is async even in the stub, so a fast unmount can resolve after teardown.
    // `cancelled` stops us opening a subscription nobody will ever close.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const id = await pantry.signIn();
        if (cancelled) return;
        setUid(id);
        unsubscribe = pantry.subscribe(
          id,
          (next) => {
            setRows(next);
            setError(null);
            setLoading(false);
          },
          // A listen can fail *after* it succeeded (rules edited, network lost), so this
          // clears `loading` rather than assuming the first snapshot already did.
          (message) => {
            if (cancelled) return;
            setError(message);
            setLoading(false);
          },
        );
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        // signIn() no longer does auth, so this path is now only reachable if the store
        // itself throws. Show whatever it said rather than inventing a message.
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't load your pantry.",
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { rows, uid, loading, error };
}
