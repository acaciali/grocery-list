import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, type UserPrefs } from '@grocery/shared';

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
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  // Follow auth rather than calling currentUid(): sign-in happens in parallel with the
  // first render and can fail outright, and neither case should throw in here.
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid ?? null)), []);

  useEffect(() => {
    if (uid === null) {
      setPrefs({});
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        setPrefs((snap.data() as UserPrefs | undefined) ?? {});
        setLoading(false);
      },
      (err) => {
        // Rules not yet deployed, or signed out. The list works without prefs.
        console.error('store prefs subscription failed', err);
        setPrefs({});
        setLoading(false);
      },
    );
  }, [uid]);

  const store =
    prefs?.storeLocationId != null
      ? { locationId: prefs.storeLocationId, name: prefs.storeName ?? prefs.storeLocationId }
      : null;

  function requireUid(): string {
    if (uid === null) {
      throw new Error("You're signed out, so your store can't be saved. Reload and try again.");
    }
    return uid;
  }

  return {
    store,
    zip: prefs?.zip ?? null,
    loading,
    connect: (next, zip) =>
      setDoc(
        doc(db, 'users', requireUid()),
        { storeLocationId: next.locationId, storeName: next.name, zip },
        { merge: true },
      ),
    disconnect: () =>
      setDoc(
        doc(db, 'users', requireUid()),
        { storeLocationId: null, storeName: null },
        { merge: true },
      ),
  };
}
