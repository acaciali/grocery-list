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
        // The store already translated this into something worth reading (which setup
        // step is missing, usually), so show that rather than flattening it again.
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't sign in, so your pantry didn't load.",
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
