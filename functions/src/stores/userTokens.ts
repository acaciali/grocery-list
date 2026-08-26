import { db, withDeadline } from '../db.js';
import { refreshUserToken, type UserTokens } from './token.js';

/**
 * Kroger user tokens live at users/{uid}/private/kroger.
 *
 * firestore.rules denies every client read and write under users/{uid}/private/** -- a
 * refresh token readable from the browser is an account compromise, not a demo bug. Only
 * the Admin SDK, which bypasses rules, ever touches this path.
 */
const KROGER_DOC = 'kroger';
const PENDING_DOC = 'krogerOAuth';

function privateDoc(uid: string, doc: string) {
  return db().collection('users').doc(uid).collection('private').doc(doc);
}

interface StoredTokens extends UserTokens {
  updatedAtMs: number;
}

export async function saveUserTokens(uid: string, tokens: UserTokens): Promise<void> {
  await withDeadline(
    privateDoc(uid, KROGER_DOC).set({ ...tokens, updatedAtMs: Date.now() } satisfies StoredTokens),
    'kroger token write',
  );
}

export async function readUserTokens(uid: string): Promise<StoredTokens | null> {
  const snap = await withDeadline(privateDoc(uid, KROGER_DOC).get(), 'kroger token read');
  return (snap.data() as StoredTokens | undefined) ?? null;
}

export async function clearUserTokens(uid: string): Promise<void> {
  await withDeadline(privateDoc(uid, KROGER_DOC).delete(), 'kroger token delete');
}

/** Thrown when a user has no usable Kroger authorization. Callers map this to 401. */
export class NotLinkedError extends Error {
  constructor(message = 'Kroger account is not linked for this user') {
    super(message);
    this.name = 'NotLinkedError';
  }
}

/**
 * A valid access token for this user, refreshing and re-persisting when the stored one
 * has aged out.
 *
 * A refresh that fails is terminal, not transient: Kroger refresh tokens are single-use
 * and expire, so the honest outcome is to drop the record and make the user re-link. A
 * silent retry loop here would present as "the cart button does nothing".
 */
export async function validUserToken(uid: string): Promise<string> {
  const stored = await readUserTokens(uid);
  if (!stored) throw new NotLinkedError();
  if (Date.now() < stored.expiresAtMs) return stored.accessToken;

  try {
    const refreshed = await refreshUserToken(stored.refreshToken);
    await saveUserTokens(uid, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    console.error('kroger refresh failed; unlinking', err);
    await clearUserTokens(uid).catch(() => {});
    throw new NotLinkedError('Kroger authorization expired -- link the account again');
  }
}

export async function isLinked(uid: string): Promise<boolean> {
  const stored = await readUserTokens(uid);
  return stored !== null;
}

// --- OAuth handshake state -------------------------------------------------------------

interface PendingAuth {
  nonce: string;
  redirect: string;
  createdAtMs: number;
}

/** Ten minutes is far longer than a real consent screen takes and short enough to matter. */
const PENDING_TTL_MS = 10 * 60 * 1000;

export async function savePendingAuth(uid: string, pending: PendingAuth): Promise<void> {
  await withDeadline(privateDoc(uid, PENDING_DOC).set(pending), 'oauth state write');
}

/**
 * Consume the pending handshake, verifying the nonce.
 *
 * Single-use by construction: the doc is deleted whether or not the nonce matched, so a
 * replayed callback finds nothing. Returns the app redirect the flow started from.
 */
export async function takePendingAuth(uid: string, nonce: string): Promise<PendingAuth> {
  const ref = privateDoc(uid, PENDING_DOC);
  const snap = await withDeadline(ref.get(), 'oauth state read');
  await withDeadline(ref.delete(), 'oauth state delete').catch(() => {});

  const pending = snap.data() as PendingAuth | undefined;
  if (!pending) throw new Error('no pending Kroger authorization for this user');
  if (pending.nonce !== nonce) throw new Error('state mismatch -- possible CSRF, refusing');
  if (Date.now() - pending.createdAtMs > PENDING_TTL_MS) {
    throw new Error('authorization request expired -- start again');
  }
  return pending;
}
