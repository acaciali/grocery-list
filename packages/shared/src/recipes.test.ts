/**
 * Recipe reads with the Firestore SDK mocked out, same approach as inventory.test.ts:
 * verify OUR logic -- id attachment, the local-echo timestamp guard, and that
 * findRecipeMatches actually joins the two collections -- with zero setup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Keyed by collection name rather than call order: findRecipeMatches fires both reads
 * inside one Promise.all, and a test that depends on which resolves first would break the
 * day someone reorders the destructuring for no reason.
 */
const mocks = vi.hoisted(() => ({
  docsByCollection: {} as Record<string, Array<{ id: string; data: Record<string, unknown> }>>,
  getDoc: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ exists: () => false })),
  onSnapshot: vi.fn<(...args: unknown[]) => () => void>(() => () => {}),
}));

vi.mock('./firebase.js', () => ({ db: { __mock: 'db' } }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` }),
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  getDoc: mocks.getDoc,
  getDocs: async (ref: { __collection: string }) => ({
    docs: (mocks.docsByCollection[ref.__collection] ?? []).map((d) => ({
      id: d.id,
      data: () => d.data,
    })),
  }),
  onSnapshot: mocks.onSnapshot,
  // Unused here, but inventory.js is in recipes.js's import graph and pulls them in.
  serverTimestamp: () => 'SERVER_TS',
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: () => ({ set: () => {}, commit: async () => {} }),
}));

import { normalizeKey } from './items.js';
import {
  findRecipeMatches,
  getRecipe,
  listRecipes,
  subscribeToRecipes,
} from './recipes.js';

function ingredient(name: string) {
  return { key: normalizeKey(name), name, category: 'other' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.docsByCollection = {};
});

describe('listRecipes', () => {
  it('attaches the Firestore doc id -- it is what a detail route links to', async () => {
    mocks.docsByCollection.recipes = [
      { id: 'abc123', data: { title: 'Pancakes', ingredients: [] } },
    ];
    // toMatchObject, not toEqual: toRow also fills the contract fields a sparse document
    // is missing (tags, steps, createdBy). Those are covered in their own test below.
    expect(await listRecipes()).toMatchObject([
      { id: 'abc123', title: 'Pancakes', ingredients: [] },
    ]);
  });

  it('returns an empty cookbook rather than throwing', async () => {
    expect(await listRecipes()).toEqual([]);
  });
});

describe('legacy vanilla documents', () => {
  /** Exactly what the un-ported recipes.js writes to this same collection. */
  const legacyDoc = {
    name: 'Sunday chili',
    servings: 4,
    minutes: 90,
    ingredients: [
      { amount: '2 cans', name: 'black beans' },
      { amount: '1 tsp', name: 'cumin' },
    ],
    steps: ['Brown the onions.'],
  };

  it('⭐ derives a key for every legacy ingredient, so old recipes can match at all', async () => {
    mocks.docsByCollection.recipes = [{ id: 'old1', data: legacyDoc }];
    const [row] = await listRecipes();
    expect(row?.ingredients).toEqual([
      { key: normalizeKey('black beans'), name: 'black beans', category: 'other', quantity: null, unit: null },
      { key: normalizeKey('cumin'), name: 'cumin', category: 'other', quantity: null, unit: null },
    ]);
  });

  it('maps the old field names onto the contract', async () => {
    mocks.docsByCollection.recipes = [{ id: 'old1', data: legacyDoc }];
    const [row] = await listRecipes();
    expect(row).toMatchObject({ title: 'Sunday chili', totalMinutes: 90, servings: 4 });
  });

  it('fills the required fields a legacy document simply does not have', async () => {
    mocks.docsByCollection.recipes = [{ id: 'old1', data: legacyDoc }];
    const [row] = await listRecipes();
    expect(row).toMatchObject({ tags: [], createdBy: 'single-user' });
  });

  it('leaves a contract document alone', async () => {
    mocks.docsByCollection.recipes = [
      {
        id: 'new1',
        data: {
          title: 'Pancakes',
          totalMinutes: 20,
          ingredients: [{ key: 'milk', name: 'whole milk', category: 'dairy', quantity: 2, unit: 'cup' }],
          steps: [],
          tags: ['breakfast'],
          createdBy: 'single-user',
        },
      },
    ];
    const [row] = await listRecipes();
    expect(row).toMatchObject({ title: 'Pancakes', totalMinutes: 20, tags: ['breakfast'] });
    expect(row?.ingredients[0]).toEqual({
      key: 'milk', name: 'whole milk', category: 'dairy', quantity: 2, unit: 'cup',
    });
  });

  it('names an untitled document rather than leaving it undefined', async () => {
    mocks.docsByCollection.recipes = [{ id: 'junk', data: {} }];
    const [row] = await listRecipes();
    expect(row).toMatchObject({ title: 'Untitled recipe', ingredients: [], steps: [] });
  });

  it('drops an ingredient line with nothing identifying, keeping the recipe', async () => {
    // "2 cups" is all quantity and unit -- normalizeKey strips both and throws, because a
    // keyless item cannot be stored or matched. The recipe must still load without it.
    // (Note "a pinch of" does NOT qualify: it keys as `pinch`, since only leading
    // measurement words are dropped.)
    mocks.docsByCollection.recipes = [
      { id: 'old2', data: { name: 'Soup', ingredients: [{ name: '2 cups' }, { name: 'leeks' }] } },
    ];
    const [row] = await listRecipes();
    expect(row?.ingredients.map((i) => i.name)).toEqual(['leeks']);
  });

  it('⭐ a legacy recipe now matches a pantry end to end', async () => {
    mocks.docsByCollection.recipes = [{ id: 'old1', data: legacyDoc }];
    mocks.docsByCollection.inventory = [
      { id: normalizeKey('black beans'), data: { key: normalizeKey('black beans') } },
    ];
    const [match] = await findRecipeMatches();
    expect(match).toMatchObject({ haveCount: 1, missingCount: 1, totalCount: 2 });
    expect(match?.recipe.title).toBe('Sunday chili');
  });
});

describe('getRecipe', () => {
  it('reads the document at the id', async () => {
    mocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'abc123',
      data: () => ({ title: 'Pancakes' }),
    });
    expect(await getRecipe('abc123')).toMatchObject({ id: 'abc123', title: 'Pancakes' });
    expect(mocks.getDoc).toHaveBeenCalledWith({ path: 'recipes/abc123' });
  });

  it('answers null for a dead link instead of throwing', async () => {
    expect(await getRecipe('gone')).toBeNull();
  });
});

describe('subscribeToRecipes', () => {
  it('maps snapshots with estimated timestamps and returns unsubscribe', () => {
    const received: unknown[][] = [];
    const unsubscribe = subscribeToRecipes((recipes) => received.push(recipes));

    const [ref, listener] = mocks.onSnapshot.mock.calls[0] ?? [];
    expect(ref).toEqual({ __collection: 'recipes' });

    const seenOpts: unknown[] = [];
    (listener as (snap: unknown) => void)({
      docs: [
        {
          id: 'abc123',
          data: (opts?: unknown) => {
            seenOpts.push(opts);
            return { title: 'Pancakes' };
          },
        },
      ],
    });

    expect(received).toMatchObject([[{ id: 'abc123', title: 'Pancakes' }]]);
    // Without this, createdAt is null on the local echo and a sorted list flickers.
    expect(seenOpts).toEqual([{ serverTimestamps: 'estimate' }]);
    expect(unsubscribe).toBeTypeOf('function');
    unsubscribe();
  });
});

describe('findRecipeMatches', () => {
  beforeEach(() => {
    mocks.docsByCollection.recipes = [
      {
        id: 'pancakes',
        data: {
          title: 'Pancakes',
          ingredients: ['eggs', 'milk', 'flour'].map(ingredient),
        },
      },
      {
        id: 'sorbet',
        data: { title: 'Sorbet', ingredients: ['mango', 'lime'].map(ingredient) },
      },
    ];
    // Keys through normalizeKey, exactly as the inventory layer writes them -- hand-typed
    // "eggs" would be stored as `egg` in real life and match nothing here.
    mocks.docsByCollection.inventory = ['eggs', 'milk', 'flour'].map((name) => ({
      id: normalizeKey(name),
      data: { key: normalizeKey(name) },
    }));
  });

  it('⭐ joins the cookbook to the pantry and ranks the result', async () => {
    const matches = await findRecipeMatches();
    expect(matches.map((m) => m.recipe.id)).toEqual(['pancakes', 'sorbet']);
    expect(matches[0]).toMatchObject({ missingCount: 0, haveCount: 3 });
    expect(matches[1]?.missing.map((i) => i.name)).toEqual(['mango', 'lime']);
  });

  it('forwards options through to the matcher', async () => {
    const matches = await findRecipeMatches({ maxMissing: 0 });
    expect(matches.map((m) => m.recipe.id)).toEqual(['pancakes']);
  });
});
