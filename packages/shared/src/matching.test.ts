/**
 * Pantry matching. No mocks needed anywhere in this file -- matching.ts touches no
 * Firestore, no network and no clock, which is the main argument for it being pure.
 */
import { describe, expect, it } from 'vitest';
import { normalizeKey } from './items.js';
import {
  COMMON_STAPLES,
  matchRecipe,
  matchRecipes,
  missingAcross,
} from './matching.js';
import type { Item } from './types.js';

/** Ingredient from a display name, keyed the way every real path keys it. */
function ing(name: string, extra: Partial<Item> = {}): Item {
  return { key: normalizeKey(name), name, category: 'other', ...extra };
}

function recipe(title: string, names: string[]) {
  return { title, ingredients: names.map((n) => ing(n)) };
}

function pantry(...names: string[]) {
  return names.map(normalizeKey);
}

describe('matchRecipe', () => {
  it('splits ingredients into have and missing on exact key equality', () => {
    const result = matchRecipe(
      recipe('Omelette', ['eggs', 'butter', 'chives']),
      new Set(pantry('eggs', 'butter')),
    );
    expect(result.have.map((h) => h.item.name)).toEqual(['eggs', 'butter']);
    expect(result.missing.map((m) => m.name)).toEqual(['chives']);
    expect(result.haveCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(result.totalCount).toBe(3);
    expect(result.coverage).toBeCloseTo(2 / 3);
  });

  it('⭐ matches across apps: a recipe line and a pantry label meet at the key', () => {
    // The whole point of normalizeKey(). Nothing in matching.ts knows these differ.
    const result = matchRecipe(
      { title: 'Pancakes', ingredients: [ing('2 cups whole milk')] },
      new Set([normalizeKey('Whole Milk')]),
    );
    expect(result.missingCount).toBe(0);
  });

  it('counts a repeated ingredient once, keeping its first mention', () => {
    // "1 cup milk" for the sauce and "2 tbsp milk" for the glaze is one shopping item.
    const result = matchRecipe(
      {
        title: 'Gratin',
        ingredients: [ing('1 cup milk'), ing('potatoes'), ing('2 tbsp milk')],
      },
      new Set(pantry('potatoes')),
    );
    expect(result.totalCount).toBe(2);
    expect(result.missing.map((m) => m.name)).toEqual(['1 cup milk']);
    expect(result.coverage).toBe(0.5);
  });

  it('preserves the recipe ordering so the UI can render the list as written', () => {
    const result = matchRecipe(
      recipe('Salad', ['lettuce', 'tomato', 'cucumber', 'feta']),
      new Set(pantry('feta', 'lettuce')),
    );
    expect(result.have.map((h) => h.item.name)).toEqual(['lettuce', 'feta']);
  });

  it('scores an empty pantry as all-missing rather than failing', () => {
    const result = matchRecipe(recipe('Toast', ['bread']), new Set());
    expect(result).toMatchObject({ haveCount: 0, missingCount: 1, coverage: 0 });
  });

  it('gives an ingredient-less recipe coverage 0, not NaN', () => {
    const result = matchRecipe({ title: 'Draft', ingredients: [] }, new Set(pantry('eggs')));
    expect(result.coverage).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

describe('assumed keys', () => {
  const salted = recipe('Roast potatoes', ['potatoes', 'salt', 'black pepper']);

  it('counts assumed ingredients as had, tagged so the UI cannot overclaim', () => {
    const result = matchRecipe(
      salted,
      new Set(pantry('potatoes')),
      new Set(COMMON_STAPLES),
    );
    expect(result.missingCount).toBe(0);
    expect(result.have.map((h) => `${h.item.name}:${h.via}`)).toEqual([
      'potatoes:pantry',
      'salt:assumed',
      'black pepper:assumed',
    ]);
  });

  it('prefers pantry over assumed -- if you logged the salt, say you logged it', () => {
    const result = matchRecipe(
      salted,
      new Set(pantry('potatoes', 'salt')),
      new Set(COMMON_STAPLES),
    );
    expect(result.have.find((h) => h.item.name === 'salt')?.via).toBe('pantry');
  });

  it('assumes nothing unless asked -- staples are opt-in', () => {
    const result = matchRecipe(salted, new Set(pantry('potatoes')));
    expect(result.missing.map((m) => m.name)).toEqual(['salt', 'black pepper']);
  });

  it('COMMON_STAPLES holds real normalized keys, so it can actually match', () => {
    expect(COMMON_STAPLES).toContain(normalizeKey('Kosher Salt'));
    expect(COMMON_STAPLES).toContain(normalizeKey('1 tsp salt'));
    // Things you can genuinely run out of stay off the list.
    expect(COMMON_STAPLES).not.toContain(normalizeKey('butter'));
    expect(COMMON_STAPLES).not.toContain(normalizeKey('olive oil'));
  });

  it('covers the spellings recipes really use for pepper', () => {
    // normalizeKey keeps "ground" -- it has to, or "ground beef" would become "beef" --
    // so `ground-black-pepper` is a different key from `black-pepper` and both must be
    // listed. This test is the guard on that; it fails the day someone tidies the list.
    for (const line of [
      'freshly ground black pepper',
      '1/2 tsp black pepper',
      'Cracked black pepper',
      'Salt and pepper',
    ]) {
      const result = matchRecipe(
        { title: 'x', ingredients: [ing(line)] },
        new Set(),
        new Set(COMMON_STAPLES),
      );
      expect({ line, missing: result.missingCount }).toEqual({ line, missing: 0 });
    }
  });

  it.skip('KNOWN GAP: trailing prep phrases defeat every key, not just staples', () => {
    // "salt and pepper, to taste" keys as `salt-and-pepper-to-taste`. No staples list can
    // enumerate its way out of this -- "to taste", "for serving", "for garnish", "plus
    // more for dusting", "at room temperature" and "or as needed" trail real recipe lines
    // constantly, and each one forks a new key.
    //
    // The fix belongs in normalizeKey (strip trailing prep phrases after a comma), which
    // is a shared-contract change affecting Grocery's has() and Inventory's de-dupe too,
    // so it wants the Phase 0 all-hands rather than a unilateral edit from this feature.
    // Un-skip when that lands. See the OPEN QUESTIONS block at the top of items.ts.
    const result = matchRecipe(
      { title: 'x', ingredients: [ing('salt and pepper, to taste')] },
      new Set(),
      new Set(COMMON_STAPLES),
    );
    expect(result.missingCount).toBe(0);
  });
});

describe('matchRecipes ranking', () => {
  // Pantry: eggs, milk, flour, butter.
  const keys = pantry('eggs', 'milk', 'flour', 'butter');

  const pancakes = recipe('Pancakes', ['eggs', 'milk', 'flour']); // 3/3, missing 0
  const cake = recipe('Cake', [
    'eggs', 'milk', 'flour', 'butter', 'sugar', 'vanilla', 'baking powder',
  ]); // 4/7, missing 3
  const risotto = recipe('Risotto', ['arborio rice', 'stock', 'butter']); // 1/3, missing 2
  const sorbet = recipe('Sorbet', ['mango', 'lime']); // 0/2, missing 2

  it('defaults to fewest-missing: what you can cook tonight comes first', () => {
    const ranked = matchRecipes([cake, risotto, sorbet, pancakes], keys);
    expect(ranked.map((m) => m.recipe.title)).toEqual([
      'Pancakes', // 0 missing
      'Risotto',  // 2 missing, 1/3 covered
      'Sorbet',   // 2 missing, 0/2 covered
      'Cake',     // 3 missing
    ]);
  });

  it("sort:'matches' takes the literal reading and favours the big recipe", () => {
    const ranked = matchRecipes([pancakes, cake], keys, { sort: 'matches' });
    // Cake matches 4 ingredients to Pancakes' 3, even though you cannot bake it tonight.
    expect(ranked.map((m) => m.recipe.title)).toEqual(['Cake', 'Pancakes']);
  });

  it("sort:'coverage' ranks by fraction, so recipe size stops mattering", () => {
    const ranked = matchRecipes([cake, risotto, pancakes], keys, { sort: 'coverage' });
    expect(ranked.map((m) => m.recipe.title)).toEqual(['Pancakes', 'Cake', 'Risotto']);
  });

  it('pushes ingredient-less drafts last in every sort mode', () => {
    const draft = { title: 'Aaa untitled draft', ingredients: [] };
    for (const sort of ['missing', 'coverage', 'matches'] as const) {
      const ranked = matchRecipes([draft, sorbet], keys, { sort });
      // Sorts first on missingCount, coverage AND title without the empty guard.
      expect(ranked.at(-1)?.recipe.title).toBe('Aaa untitled draft');
    }
  });

  it('breaks ties on title so the order does not jitter between snapshots', () => {
    const b = recipe('Bbb', ['mango']);
    const a = recipe('Aaa', ['lime']);
    expect(matchRecipes([b, a], keys).map((m) => m.recipe.title)).toEqual(['Aaa', 'Bbb']);
  });

  it('keeps the caller row type, so a doc id survives to the detail link', () => {
    const rows = [{ ...pancakes, id: 'abc123' }];
    expect(matchRecipes(rows, keys)[0]?.recipe.id).toBe('abc123');
  });
});

describe('matchRecipes filters', () => {
  const keys = pantry('eggs', 'milk', 'flour');
  const pancakes = recipe('Pancakes', ['eggs', 'milk', 'flour']);
  const crepes = recipe('Crepes', ['eggs', 'milk', 'flour', 'butter']);
  const sorbet = recipe('Sorbet', ['mango', 'lime']);
  const all = [pancakes, crepes, sorbet];

  it('maxMissing:0 is the "cook it right now" filter', () => {
    const ranked = matchRecipes(all, keys, { maxMissing: 0 });
    expect(ranked.map((m) => m.recipe.title)).toEqual(['Pancakes']);
  });

  it('maxMissing:1 is the "one quick stop" filter', () => {
    const ranked = matchRecipes(all, keys, { maxMissing: 1 });
    expect(ranked.map((m) => m.recipe.title)).toEqual(['Pancakes', 'Crepes']);
  });

  it('minMatches:1 drops the recipes that share nothing with the pantry', () => {
    const ranked = matchRecipes(all, keys, { minMatches: 1 });
    expect(ranked.map((m) => m.recipe.title)).not.toContain('Sorbet');
  });

  it('limit truncates after sorting, not before', () => {
    const ranked = matchRecipes(all, keys, { limit: 1 });
    expect(ranked.map((m) => m.recipe.title)).toEqual(['Pancakes']);
  });

  it('returns everything ranked when given no filters', () => {
    expect(matchRecipes(all, keys)).toHaveLength(3);
  });

  it('accepts a Set or an array of keys, and mutates neither input', () => {
    const asArray = [...keys];
    const asSet = new Set(keys);
    const recipes = [...all];
    expect(matchRecipes(recipes, asArray)).toHaveLength(3);
    expect(matchRecipes(recipes, asSet)).toHaveLength(3);
    expect(asArray).toHaveLength(3);
    expect(asSet.size).toBe(3);
    expect(recipes.map((r) => r.title)).toEqual(['Pancakes', 'Crepes', 'Sorbet']);
  });

  it('handles an empty cookbook', () => {
    expect(matchRecipes([], keys)).toEqual([]);
  });
});

describe('malformed and pre-contract documents', () => {
  // recipes.ts adapts legacy docs on read, so these should not reach the matcher. They
  // are the seatbelt: a hand-edited document in the Firestore console must not be able to
  // crash the page or quietly overstate what the cook has.
  const keyless = {
    title: undefined as unknown as string,
    ingredients: [
      { name: 'black beans' },
      { name: 'cumin' },
      { name: 'onion' },
    ] as unknown as Item[],
  };

  it('counts keyless ingredients individually instead of collapsing them', () => {
    // The de-dupe Set treated every undefined key as the same key, so a 3-ingredient
    // recipe reported totalCount 1.
    const result = matchRecipe(keyless, new Set(pantry('onion')));
    expect(result.totalCount).toBe(3);
  });

  it('treats an unmatchable ingredient as missing, never as had', () => {
    const result = matchRecipe(keyless, new Set(pantry('onion')));
    expect(result.haveCount).toBe(0);
    expect(result.missingCount).toBe(3);
    // Overstating coverage would tell someone they can cook what they cannot.
    expect(result.coverage).toBe(0);
  });

  it('does not throw sorting two recipes with no title', () => {
    // Both tie on every numeric comparison and fall through to the title tie-break,
    // which threw a TypeError and took the whole view down with it.
    expect(() => matchRecipes([keyless, { ...keyless }], pantry('onion'))).not.toThrow();
  });

  it('tolerates a missing ingredients array', () => {
    const result = matchRecipe(
      { title: 'Broken', ingredients: undefined as unknown as Item[] },
      new Set(pantry('onion')),
    );
    expect(result).toMatchObject({ totalCount: 0, haveCount: 0, coverage: 0 });
  });
});

describe('missingAcross', () => {
  const keys = pantry('eggs');

  it('de-dupes the shopping list across recipes -- two cumins is one line', () => {
    const matches = matchRecipes(
      [recipe('Chili', ['beans', 'cumin']), recipe('Tacos', ['tortillas', 'cumin'])],
      keys,
    );
    expect(missingAcross(matches).map((i) => i.name).sort()).toEqual([
      'beans',
      'cumin',
      'tortillas',
    ]);
  });

  it('keeps quantity and unit off the recipe line for Grocery to use', () => {
    const matches = matchRecipes(
      [{ title: 'Chili', ingredients: [ing('cumin', { quantity: 2, unit: 'tsp' })] }],
      keys,
    );
    expect(missingAcross(matches)[0]).toMatchObject({ quantity: 2, unit: 'tsp' });
  });

  it('is empty when nothing is missing', () => {
    const matches = matchRecipes([recipe('Boiled egg', ['eggs'])], keys);
    expect(missingAcross(matches)).toEqual([]);
  });
});
