/**
 * One initialized Firebase app for every surface. Import `db` from here rather than
 * calling initializeApp yourself -- double initialization throws.
 *
 * POC note: this app is single-user for now, so there is no auth layer. If accounts
 * ever land, this is where sign-in helpers go.
 */
import { getApps, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

const app = getApps()[0] ?? initializeApp(firebaseConfig);

export const db = getFirestore(app);

let emulatorsConnected = false;

/**
 * Point this process at the local emulator suite (`npm run emulators`) instead of prod.
 * Call once, before any read or write. Gated behind an explicit call -- and in Vite,
 * behind an env flag -- so nobody develops against prod by accident.
 */
export function connectEmulators(host = '127.0.0.1'): void {
  if (emulatorsConnected) return;
  connectFirestoreEmulator(db, host, 8080);
  emulatorsConnected = true;
}
