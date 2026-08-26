import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './storeApi';

/**
 * Firestore is mocked rather than emulated: what is worth testing here is the contract
 * `localStore` has to match -- the same caps, the same status codes, the same abort
 * behaviour as the Cloud Function -- not Firestore itself. The matching and the fixtures
 * are tested where they live, in @grocery/shared/store.
 */
vi.mock('@grocery/shared', () => ({ db: {} }));

type Snapshot = { data: () => Record<string, unknown> | undefined };

const getDoc = vi.fn(async (): Promise<Snapshot> => ({ data: () => undefined }));
const setDoc = vi.fn(async () => undefined);
vi.mock('firebase/firestore', () => ({
  doc: (...path: unknown[]) => path,
  getDoc: (...args: unknown[]) => getDoc(...(args as [])),
  setDoc: (...args: unknown[]) => setDoc(...(args as [])),
}));

const { localStore } = await import('./localStore');

/** Node has no localStorage, and the demo link flag is the one thing that needs it. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

beforeEach(() => {
  getDoc.mockClear();
  setDoc.mockClear();
  stubStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('search', () => {
  it('answers from the shared fixtures', async () => {
    const products = await localStore.searchProducts('milk', 'mock-01400376');
    expect(products).toHaveLength(1);
    expect(products[0]?.upc).toBe('0001111041700');
  });

  it('rejects when the caller aborts, so a stale result cannot land', async () => {
    const controller = new AbortController();
    const pending = localStore.searchProducts('slow milk', 'mock-01400376', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });

  it('rejects immediately on a signal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      localStore.searchProducts('milk', 'mock-01400376', controller.signal),
    ).rejects.toThrow(/abort/i);
  });
});

describe('resolveItems', () => {
  it('resolves nothing without calling the store', async () => {
    expect(await localStore.resolveItems('loc', [], null)).toEqual({});
  });

  it('matches confidently where the resolver is confident', async () => {
    const matches = await localStore.resolveItems('loc', [{ id: 'a', name: 'milk' }], null);
    expect(matches.a?.status).toBe('matched');
    expect(matches.a?.locationId).toBe('loc');
  });

  it('leaves an ambiguous item for a human', async () => {
    const matches = await localStore.resolveItems('loc', [{ id: 'b', name: 'bread' }], null);
    expect(matches.b?.status).toBe('ambiguous');
    expect(matches.b?.candidates?.length).toBeGreaterThan(1);
  });

  it('enforces the same batch cap as the function, with the same status', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ id: `i${i}`, name: 'milk' }));
    await expect(localStore.resolveItems('loc', items, null)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('replays a remembered pick instead of searching', async () => {
    const remembered = { productId: 'p1', upc: '0009', name: 'The one I picked' };
    getDoc.mockResolvedValueOnce({ data: () => ({ product: remembered }) });

    const matches = await localStore.resolveItems('loc', [{ id: 'a', name: 'bread' }], 'uid-1');

    // 'bread' is the ambiguous fixture, so a plain search could not have produced 'matched'.
    expect(matches.a?.status).toBe('matched');
    expect(matches.a?.chosenBy).toBe('memory');
    expect(matches.a?.product?.productId).toBe('p1');
  });

  it('falls back to searching when the pref read fails', async () => {
    getDoc.mockRejectedValueOnce(new Error('offline'));
    const matches = await localStore.resolveItems('loc', [{ id: 'a', name: 'milk' }], 'uid-1');
    expect(matches.a?.status).toBe('matched');
  });
});

describe('linking and sending', () => {
  const line = { itemId: 'a', upc: '0001111041700', quantity: 1 };
  const send = { uid: 'uid-1', locationId: 'loc', modality: 'PICKUP' as const, lines: [line] };

  it('starts unlinked', async () => {
    expect(await localStore.krogerLinked('uid-1')).toBe(false);
  });

  it('refuses to send while unlinked, with the 401 the UI re-prompts on', async () => {
    await expect(localStore.sendToCart(send)).rejects.toBeInstanceOf(ApiError);
    await expect(localStore.sendToCart(send)).rejects.toMatchObject({ status: 401 });
  });

  it('links per uid, and hands back a URL carrying the callback param', async () => {
    const url = await localStore.krogerAuthUrl('uid-1', 'https://example.test/grocery');
    expect(new URL(url).searchParams.get('kroger')).toBe('linked');
    expect(await localStore.krogerLinked('uid-1')).toBe(true);
    // A different anonymous identity must not inherit the link.
    expect(await localStore.krogerLinked('uid-2')).toBe(false);
  });

  it('sends per line once linked', async () => {
    await localStore.krogerAuthUrl('uid-1', 'https://example.test/grocery');
    const result = await localStore.sendToCart({
      ...send,
      lines: [line, { itemId: 'b', upc: '0001111000101', quantity: 2 }],
    });
    expect(result.results).toEqual([
      { itemId: 'a', ok: true },
      { itemId: 'b', ok: true },
    ]);
    expect(result.batchId).toBeTruthy();
  });

  it('rejects an unsendable line as a 400, like the function', async () => {
    await localStore.krogerAuthUrl('uid-1', 'https://example.test/grocery');
    await expect(
      localStore.sendToCart({ ...send, lines: [{ ...line, upc: '' }] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('rememberChoice', () => {
  it('writes the pick under the shared pref doc id', async () => {
    const product = { productId: 'p1', upc: '0009', name: 'Kroger 2% Milk' };
    await localStore.rememberChoice('uid-1', '  Whole   MILK  ', product);

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [path, body] = setDoc.mock.calls[0] as unknown as [unknown[], { term: string }];
    // path[0] is the db handle that doc() takes first; the rest is the collection path.
    expect(path.slice(1)).toEqual(['users', 'uid-1', 'productPrefs', 'whole milk']);
    expect(body.term).toBe('whole milk');
  });
});
