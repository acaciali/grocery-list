/**
 * One initialized Firebase app for every surface. Import `db`/`auth` from here rather
 * than calling initializeApp yourself -- double initialization throws.
 */
import { getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

const app = getApps()[0] ?? initializeApp(firebaseConfig);

/**
 * Persistent local cache rather than the in-memory default. A grocery list gets used
 * inside a store on bad signal, where the memory cache means a blank screen; with this,
 * the last synced list is there and edits queue until the connection comes back.
 *
 * Multi-tab manager so a second tab shares the IndexedDB lease instead of being denied it.
 *
 * initializeFirestore throws once Firestore has been started for this app -- which happens
 * under Vite HMR -- so fall back to the running instance rather than taking the page down.
 */
function startFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = startFirestore();
export const auth = getAuth(app);

let emulatorsConnected = false;

/**
 * Point this process at the local emulator suite (`npm run emulators`) instead of prod.
 * Call once, before any read or write. Gated behind an explicit call -- and in Vite,
 * behind an env flag -- so nobody develops against prod by accident.
 */
export function connectEmulators(host = '127.0.0.1'): void {
  if (emulatorsConnected) return;
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  emulatorsConnected = true;
}

/**
 * Anonymous auth is enough for the hackathon: each device gets a stable uid.
 * Caveat worth knowing: anonymous uids are per-browser-storage. Clear site data or open
 * an incognito window and you get a fresh, empty pantry.
 */
export async function ensureSignedIn(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

/**
 * The uid for data-layer writes. Throws instead of returning undefined so a call made
 * before sign-in fails loudly rather than writing an orphan document.
 */
export function currentUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Not signed in -- call ensureSignedIn() before using the data layer.');
  }
  return uid;
}
