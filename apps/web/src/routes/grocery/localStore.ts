/**
 * The store, answered entirely in the browser by the mock fixtures.
 *
 * This exists because of a hard platform boundary, not as a testing convenience: deploying
 * a Cloud Function requires Firebase's paid Blaze plan, so on the free Spark plan there is
 * no server anywhere. This implementation is what makes the grocery surface work on a
 * Spark project served from static hosting -- store picker, search, matching, the link
 * round trip, and sending, all real code paths against fake products.
 *
 * What it cannot do is talk to Kroger. The client-credentials token needs a secret that
 * would be public in browser JavaScript, and Kroger sends no CORS headers regardless. So
 * every product here is a fixture, and `isDemoStore` in `api.ts` is what the UI uses to
 * say so. Never present these prices as real ones.
 *
 * It shares the matching, the fixtures, and the doc-id derivation with the Cloud Function
 * via @grocery/shared/store, so the two modes agree rather than approximating each other.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@grocery/shared';
import type { StoreMatch, StoreProduct } from '@grocery/shared';
import {
  MockStore,
  fromRemembered,
  prefDocId,
  queryKey,
  toMatch,
  validateLines,
} from '@grocery/shared/store';
import {
  ApiError,
  RESOLVE_BATCH_LIMIT,
  type ResolveInput,
  type SendInput,
  type SendLineResult,
  type SendResult,
  type StoreApi,
} from './storeApi';

const store = new MockStore();

/** Mirrors the server's cap on a search term. */
const MAX_TERM = 128;

/**
 * Make a promise honour an AbortSignal the way `fetch` does.
 *
 * The callers debounce type-ahead by aborting in an effect cleanup and treat a rejection
 * with `signal.aborted` as "ignore this" -- so a local implementation that resolved anyway
 * would land a stale result over a newer one.
 */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The demo link flag.
 *
 * Per-browser rather than in Firestore, which is the honest home for it: there is no
 * Kroger authorization to persist, and anonymous auth is per-browser-storage anyway, so a
 * cleared site and a fresh uid should both start unlinked. Keeping it out of Firestore also
 * keeps a fake credential from looking like a real one in the console.
 */
const LINK_KEY = 'grocery:demoStoreLinked';
const linkKeyFor = (uid: string) => `${LINK_KEY}:${uid}`;

/** localStorage throws outright in some privacy modes; an unlinked demo beats a dead page. */
function readLinked(uid: string): boolean {
  try {
    return localStorage.getItem(linkKeyFor(uid)) === 'true';
  } catch {
    return false;
  }
}

function writeLinked(uid: string): void {
  try {
    localStorage.setItem(linkKeyFor(uid), 'true');
  } catch {
    /* The redirect still reports success; the flag simply won't survive a reload. */
  }
}

function prefRef(uid: string, term: string) {
  return doc(db, 'users', uid, 'productPrefs', prefDocId(term));
}

/**
 * Read this user's remembered pick. Client-legal: firestore.rules grants the owner read
 * and write on users/{uid}/productPrefs, which is why this mode needs no rules change.
 */
async function readProductPref(uid: string, term: string): Promise<StoreProduct | null> {
  try {
    const snap = await getDoc(prefRef(uid, term));
    return (snap.data()?.product as StoreProduct | undefined) ?? null;
  } catch (err) {
    // A cache miss and a broken cache should behave identically to the caller.
    console.error('product pref read failed', err);
    return null;
  }
}

function batchId(): string {
  // randomUUID needs a secure context; a LAN-IP dev server is not one, and a demo send is
  // not worth a crash over an id nothing joins on.
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now()}`;
  }
}

export const localStore: StoreApi = {
  findStores(zip, signal) {
    return abortable(store.findStores(zip), signal);
  },

  searchProducts(q, locationId, signal) {
    return abortable(store.searchProducts(q.slice(0, MAX_TERM), locationId, 10), signal);
  },

  async resolveItems(
    locationId: string,
    items: ResolveInput[],
    uid: string | null,
    signal?: AbortSignal,
  ): Promise<Record<string, StoreMatch>> {
    if (items.length === 0) return {};
    // Same cap and same message as the function, so a caller that outgrows it fails the
    // same way in both modes rather than only in production.
    if (items.length > RESOLVE_BATCH_LIMIT) {
      throw new ApiError(`at most ${RESOLVE_BATCH_LIMIT} items per call`, 400);
    }

    const entries = await abortable(
      Promise.all(
        items.map(async (item): Promise<[string, StoreMatch]> => {
          // Your own previous pick for this exact text wins over any fresh search.
          const remembered = uid ? await readProductPref(uid, item.name) : null;
          if (remembered) return [item.id, fromRemembered(remembered, locationId)];
          const products = await store.searchProducts(item.name.slice(0, MAX_TERM), locationId, 10);
          return [item.id, toMatch(item.name, products, locationId)];
        }),
      ),
      signal,
    );
    return Object.fromEntries(entries);
  },

  async rememberChoice(uid, term, product) {
    await setDoc(prefRef(uid, term), {
      product,
      term: queryKey(term),
      updatedAtMs: Date.now(),
    });
  },

  async krogerLinked(uid) {
    return readLinked(uid);
  },

  /**
   * Stand in for Kroger's consent screen by handing back the app's own return URL with the
   * success param the real callback would add. The caller navigates to it, so the whole
   * round trip -- including the banner on the way back -- runs exactly as it does live.
   */
  async krogerAuthUrl(uid, redirect) {
    writeLinked(uid);
    const url = new URL(redirect);
    url.searchParams.set('kroger', 'linked');
    return url.toString();
  },

  async sendToCart(input: SendInput): Promise<SendResult> {
    if (!readLinked(input.uid)) {
      throw new ApiError('This browser is not linked to the demo store.', 401);
    }

    let lines;
    try {
      lines = validateLines(input.lines);
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err), 400);
    }

    // Per line, like the function: a batch answers pass-or-fail for the whole call with no
    // read-back to reconcile against, and per-line results are what the UI can actually
    // show. No cartBatches mirror here -- clients cannot write it, and nothing reads it.
    const results: SendLineResult[] = [];
    for (const line of lines) {
      try {
        await store.addToCart('demo-token', [{ upc: line.upc, quantity: line.quantity }], input.modality);
        results.push({ itemId: line.itemId, ok: true });
      } catch (err) {
        results.push({
          itemId: line.itemId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { batchId: batchId(), results };
  },
};
