import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore is initialized lazily, on first use.
 *
 * At module load, getFirestore() runs the moment esbuild's bundle is required -- which is
 * when the Functions runtime *discovers* handlers, before any request. A config problem
 * there takes down every function in the codebase, including the ones that never touch
 * Firestore. Deferring it scopes the blast radius to the call that actually needs it.
 */
let handle: Firestore | null = null;

export function db(): Firestore {
  if (!handle) {
    if (getApps().length === 0) initializeApp();
    handle = getFirestore();
  }
  return handle;
}

/**
 * An unreachable Firestore does not fail fast. The Admin SDK retries a gRPC connection
 * with backoff for well over a minute, so "the emulator isn't running" presents as a
 * request that hangs and returns nothing -- not as the error a try/catch would see.
 *
 * Anything that promises to degrade gracefully needs a deadline, because the failure mode
 * we actually hit is a hang, not a throw.
 */
export const DEADLINE_MS = 3_000;

export function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${DEADLINE_MS}ms -- is Firestore reachable?`)),
      DEADLINE_MS,
    );
    // Don't hold the process open on a timer nobody is waiting for.
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}
