import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { currentUid, db, type UserPrefs } from '@grocery/shared';

export interface ConnectedStore {
  locationId: string;
  name: string;
}

/**
 * The connected store, live from users/{uid}.
 *
 * `loading` matters: until prefs arrive we cannot tell "no store connected" from "not
 * loaded yet", and rendering the picker at someone who already picked a store is the
 * kind of flicker that makes an app feel broken.
 */
export function useConnectedStore(): {
  store: ConnectedStore | null;
  zip: string | null;
  loading: boolean;
  connect: (store: ConnectedStore, zip: string) => Promise<void>;
  disconnect: () => Promise<void>;
} {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'users', currentUid());
    return onSnapshot(
      ref,
      (snap) => {
        setPrefs((snap.data() as UserPrefs | undefined) ?? {});
        setLoading(false);
      },
      (err) => {
        console.error('store prefs subscription failed', err);
        setPrefs({});
        setLoading(false);
      },
    );
  }, []);

  const store =
    prefs?.storeLocationId != null
      ? { locationId: prefs.storeLocationId, name: prefs.storeName ?? prefs.storeLocationId }
      : null;

  return {
    store,
    zip: prefs?.zip ?? null,
    loading,
    connect: (next, zip) =>
      setDoc(
        doc(db, 'users', currentUid()),
        { storeLocationId: next.locationId, storeName: next.name, zip },
        { merge: true },
      ),
    disconnect: () =>
      setDoc(
        doc(db, 'users', currentUid()),
        { storeLocationId: null, storeName: null },
        { merge: true },
      ),
  };
}
