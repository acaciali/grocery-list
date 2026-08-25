/**
 * Unit tests for the inventory data layer with the Firestore SDK mocked out.
 *
 * These verify OUR logic -- key derivation, doc-ID construction, undefined-stripping,
 * batch chunking and de-dupe -- and run with zero setup on every `npm test`.
 * inventory.emulator.test.ts remains the check on real Firestore + rules behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SERVER_TS = Symbol('serverTimestamp');

const mocks = vi.hoisted(() => ({
  setDoc: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  deleteDoc: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  getDoc: vi.fn<(...args: unknown[]) => Promise<{ exists: () => boolean }>>(
    async () => ({ exists: () => false }),
  ),
  getDocs: vi.fn<
    (...args: unknown[]) => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }>
  >(async () => ({ docs: [] })),
  onSnapshot: vi.fn<(...args: unknown[]) => () => void>(() => () => {}),
  commits: [] as Array<Array<{ path: string; data: Record<string, unknown> }>>,
  currentUid: vi.fn<() => string>(() => 'user-1'),
}));

vi.mock('./firebase.js', () => ({
  db: { __mock: 'db' },
  currentUid: mocks.currentUid,
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` }),
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  query: (target: unknown, ...constraints: unknown[]) => ({ target, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  serverTimestamp: () => SERVER_TS,
  setDoc: mocks.setDoc,
  deleteDoc: mocks.deleteDoc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  onSnapshot: mocks.onSnapshot,
  writeBatch: () => {
    const ops: Array<{ path: string; data: Record<string, unknown> }> = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ path: ref.path, data }),
      commit: async () => {
        mocks.commits.push(ops);
      },
    };
  },
}));

import {
  batchUpsertItems,
  getAllKeys,
  has,
  hasMany,
  listItems,
  removeItem,
  subscribeToInventory,
  updateItem,
  upsertItem,
} from './inventory.js';
import { asItemKey, normalizeKey } from './items.js';
import type { InventoryItemInput } from './types.js';

const milk = (overrides: Partial<InventoryItemInput> = {}): InventoryItemInput => ({
  name: 'Whole Milk',
  category: 'dairy',
  location: 'fridge',
  addedVia: 'manual',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commits.length = 0;
  mocks.currentUid.mockReturnValue('user-1');
});

describe('upsertItem', () => {
  it('derives the key from the name via normalizeKey and returns it', async () => {
    const key = await upsertItem(milk());
    expect(key).toBe('milk');
  });

  it('writes to the deterministic doc ID uid__key with merge', async () => {
    await upsertItem(milk());
    expect(mocks.setDoc).toHaveBeenCalledWith(
      { path: 'inventory/user-1__milk' },
      expect.objectContaining({ key: 'milk', userId: 'user-1', updatedAt: SERVER_TS }),
      { merge: true },
    );
  });

  it('prefers a caller-supplied key over deriving one', async () => {
    const key = await upsertItem(milk({ key: asItemKey('oat-milk') }));
    expect(key).toBe('oat-milk');
    expect(mocks.setDoc.mock.calls[0]?.[0]).toEqual({ path: 'inventory/user-1__oat-milk' });
  });

  it('strips undefined fields so a merge cannot blank untouched data', async () => {
    await upsertItem(milk({ quantity: undefined, unit: undefined }));
    const written = mocks.setDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('quantity' in written).toBe(false);
    expect('unit' in written).toBe(false);
  });

  it('keeps explicit nulls -- the contract uses null, not absence, for "cleared"', async () => {
    await upsertItem(milk({ quantity: null }));
    const written = mocks.setDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written.quantity).toBeNull();
  });

  it('stores quantity and unit when supplied (manual entry supports amounts)', async () => {
    await upsertItem(milk({ quantity: 2, unit: 'l' }));
    expect(mocks.setDoc.mock.calls[0]?.[1]).toMatchObject({ quantity: 2, unit: 'l' });
  });

  it('throws when signed out, before any write', async () => {
    mocks.currentUid.mockImplementation(() => {
      throw new Error('Not signed in');
    });
    await expect(upsertItem(milk())).rejects.toThrow(/Not signed in/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});

describe('batchUpsertItems', () => {
  it('de-dupes by key within the batch, later entries winning', async () => {
    const keys = await batchUpsertItems([
      milk({ name: 'Whole Milk', location: 'fridge' }),
      milk({ name: 'whole milk', location: 'freezer' }),
    ]);
    expect(keys).toEqual(['milk']);
    expect(mocks.commits).toHaveLength(1);
    expect(mocks.commits[0]).toHaveLength(1);
    expect(mocks.commits[0]?.[0]?.data.location).toBe('freezer');
  });

  it('chunks at the 500-op Firestore batch limit', async () => {
    const inputs = Array.from({ length: 1001 }, (_, i) =>
      milk({ name: `item ${i} thing` }),
    );
    await batchUpsertItems(inputs);
    expect(mocks.commits.map((c) => c.length)).toEqual([500, 500, 1]);
  });

  it('commits nothing for an empty input', async () => {
    expect(await batchUpsertItems([])).toEqual([]);
    expect(mocks.commits).toHaveLength(0);
  });
});

describe('updateItem', () => {
  it('merges only defined patch fields plus a fresh updatedAt', async () => {
    await updateItem(normalizeKey('milk'), { quantity: 2, unit: undefined });
    const [ref, data, opts] = mocks.setDoc.mock.calls[0] ?? [];
    expect(ref).toEqual({ path: 'inventory/user-1__milk' });
    expect(data).toEqual({ quantity: 2, updatedAt: SERVER_TS });
    expect(opts).toEqual({ merge: true });
  });
});

describe('reads', () => {
  it('has() does a single doc lookup at uid__key', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true });
    expect(await has(normalizeKey('milk'))).toBe(true);
    expect(mocks.getDoc).toHaveBeenCalledWith({ path: 'inventory/user-1__milk' });
  });

  it('hasMany de-dupes input keys and answers every one', async () => {
    mocks.getDoc
      .mockResolvedValueOnce({ exists: () => true })
      .mockResolvedValueOnce({ exists: () => false });
    const result = await hasMany([
      normalizeKey('milk'),
      normalizeKey('Whole Milk'), // same key -- must not trigger a second lookup
      normalizeKey('saffron'),
    ]);
    expect(mocks.getDoc).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ milk: true, saffron: false });
  });

  it('getAllKeys queries scoped to the current user -- the rules reject anything else', async () => {
    mocks.getDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ key: 'milk' }) }, { data: () => ({ key: 'black-bean' }) }],
    });
    expect(await getAllKeys()).toEqual(['milk', 'black-bean']);
    const q = mocks.getDocs.mock.calls[0]?.[0] as { constraints: unknown[] };
    expect(q.constraints).toContainEqual({ field: 'userId', op: '==', value: 'user-1' });
  });
});

describe('coverage parity with the local emulator suite', () => {
  it('upserting the same name twice targets the same doc -- duplicates are impossible', async () => {
    await upsertItem(milk({ name: 'Whole Milk' }));
    await upsertItem(milk({ name: '2 cups whole milk' })); // a recipe line, same key
    const paths = mocks.setDoc.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(paths).toEqual(['inventory/user-1__milk', 'inventory/user-1__milk']);
  });

  it('cross-app key matching: recipe, pantry, and lookup all land on one key', async () => {
    expect(normalizeKey('2 cups whole milk')).toBe(normalizeKey('Whole Milk'));
    await has(normalizeKey('2 cups whole milk'));
    expect(mocks.getDoc).toHaveBeenCalledWith({ path: 'inventory/user-1__milk' });
  });

  it('removeItem deletes the deterministic doc', async () => {
    await removeItem(normalizeKey('milk'));
    expect(mocks.deleteDoc).toHaveBeenCalledWith({ path: 'inventory/user-1__milk' });
  });

  it('read APIs also refuse when signed out, before any network call', async () => {
    mocks.currentUid.mockImplementation(() => {
      throw new Error('Not signed in');
    });
    await expect(has(normalizeKey('milk'))).rejects.toThrow(/Not signed in/);
    await expect(getAllKeys()).rejects.toThrow(/Not signed in/);
    await expect(listItems()).rejects.toThrow(/Not signed in/);
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('listItems maps documents through the user-scoped query', async () => {
    mocks.getDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ key: 'milk', name: 'Whole Milk' }) }],
    });
    const items = await listItems();
    expect(items).toEqual([{ key: 'milk', name: 'Whole Milk' }]);
    const q = mocks.getDocs.mock.calls[0]?.[0] as { constraints: unknown[] };
    expect(q.constraints).toContainEqual({ field: 'userId', op: '==', value: 'user-1' });
  });

  it('subscribeToInventory scopes to the user, maps with estimated timestamps, and returns unsubscribe', () => {
    const received: unknown[][] = [];
    const unsubscribe = subscribeToInventory((items) => received.push(items));

    const [q, listener] = mocks.onSnapshot.mock.calls[0] ?? [];
    expect((q as { constraints: unknown[] }).constraints).toContainEqual({
      field: 'userId', op: '==', value: 'user-1',
    });

    // Simulate a snapshot arriving and capture the data() options.
    const seenOpts: unknown[] = [];
    (listener as (snap: unknown) => void)({
      docs: [
        {
          data: (opts?: unknown) => {
            seenOpts.push(opts);
            return { key: 'milk' };
          },
        },
      ],
    });
    expect(received).toEqual([[{ key: 'milk' }]]);
    // The local-echo guard: serverTimestamp() is null until the round-trip without this.
    expect(seenOpts).toEqual([{ serverTimestamps: 'estimate' }]);
    expect(unsubscribe).toBeTypeOf('function');
    unsubscribe();
  });

  // NOT unit-testable, by design: security-rules enforcement (another user's reads
  // denied, forged doc IDs rejected, unconstrained collection reads refused) and true
  // merge semantics. Mocks would only test themselves. Those live in the local-only
  // emulator suite: packages/shared/src/inventory.emulator.test.ts (gitignored).
});
