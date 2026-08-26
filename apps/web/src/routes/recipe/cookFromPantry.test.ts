/**
 * The pure half of "Cook from my pantry". No React, no Firestore, no browser -- which is
 * the point of having split it out of the view.
 *
 * `matchRecipes` from shared is used for real rather than stubbed: these helpers exist to
 * be fed its output, and a hand-built RecipeMatch would let this file agree with itself
 * while disagreeing with the matcher.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMON_STAPLES,
  matchRecipes,
  missingAcross,
  normalizeKey,
  type Item,
  type ItemKey,
} from '@grocery/shared';
import type { AddSummary } from '../grocery/addFromRecipe';
import {
  assumedIngredients,
  countMissing,
  haveLabel,
  namesList,
  planMissingByRecipe,
  summarizeAdds,
} from './cookFromPantry';

function ingredient(name: string): Item {
  return { key: normalizeKey(name), name, category: 'other', quantity: null, unit: null };
}

/** Just enough of a RecipeRow for the matcher: it needs a title and ingredients. */
function recipe(id: string, title: string, names: string[]) {
  return { id, title, ingredients: names.map(ingredient) };
}

function pantry(...names: string[]): ItemKey[] {
  return names.map(normalizeKey);
}

function summary(added: number, merged: number): AddSummary {
  return { added, merged, mergedNames: [] };
}

/** matchRecipes always returns an array; these cases score exactly one recipe. */
function only<T>(matches: readonly T[]): T {
  const [first, ...rest] = matches;
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected exactly one match, got ${matches.length}`);
  }
  return first;
}

describe('haveLabel', () => {
  it('counts rather than percentages', () => {
    const match = only(
      matchRecipes([recipe('r1', 'Tacos', ['cumin', 'lime', 'onion'])], pantry('onion')),
    );
    expect(haveLabel(match)).toBe('You have 1 of 3');
  });

  it('says 0 of 0 for a recipe with no ingredients rather than dividing by zero', () => {
    const match = only(matchRecipes([recipe('r1', 'Draft', [])], pantry('onion')));
    expect(haveLabel(match)).toBe('You have 0 of 0');
  });
});

describe('namesList', () => {
  it('is blank for nothing missing, so the card can drop the line entirely', () => {
    expect(namesList([])).toBe('');
  });

  it('joins the names', () => {
    expect(namesList([{ name: 'cumin' }, { name: 'lime' }])).toBe('cumin, lime');
  });

  it('truncates past the limit instead of overflowing the card', () => {
    const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }];
    expect(namesList(items)).toBe('a, b, c and 2 more');
  });

  it('says "1 more", not "and 1 more" for a list exactly one over', () => {
    expect(namesList([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }])).toBe(
      'a, b, c and 1 more',
    );
  });
});

describe('assumedIngredients', () => {
  it('separates staples we assumed from things actually in the pantry', () => {
    const match = only(
      matchRecipes([recipe('r1', 'Eggs', ['eggs', 'salt', 'black pepper'])], pantry('eggs'), {
        assumedKeys: COMMON_STAPLES,
      }),
    );

    // All three count as "have" -- but only one of them is a fact.
    expect(match.haveCount).toBe(3);
    expect(assumedIngredients(match).map((i) => i.name)).toEqual(['salt', 'black pepper']);
  });

  it('is empty when the pantry genuinely holds the staple -- logged beats assumed', () => {
    const match = only(
      matchRecipes([recipe('r1', 'Eggs', ['eggs', 'salt'])], pantry('eggs', 'salt'), {
        assumedKeys: COMMON_STAPLES,
      }),
    );
    expect(assumedIngredients(match)).toEqual([]);
  });
});

describe('planMissingByRecipe', () => {
  it('buys a shared ingredient once, for the first recipe that needs it', () => {
    const matches = matchRecipes(
      [recipe('r1', 'Tacos', ['cumin', 'lime']), recipe('r2', 'Chili', ['cumin', 'beans'])],
      pantry(),
    );
    // 'missing' sort: both need 2, tie broken on title -- Chili before Tacos.
    expect(matches.map((m) => m.recipe.id)).toEqual(['r2', 'r1']);

    const groups = planMissingByRecipe(matches);
    expect(groups).toEqual([
      { recipeId: 'r2', items: [ingredient('cumin'), ingredient('beans')] },
      { recipeId: 'r1', items: [ingredient('lime')] },
    ]);
  });

  it('drops a recipe that needs nothing rather than emitting an empty write', () => {
    const matches = matchRecipes(
      [recipe('r1', 'Toast', ['bread']), recipe('r2', 'Chili', ['beans'])],
      pantry('bread'),
    );
    expect(planMissingByRecipe(matches).map((g) => g.recipeId)).toEqual(['r2']);
  });

  it('covers exactly what missingAcross does, but keeps who needed what', () => {
    const matches = matchRecipes(
      [
        recipe('r1', 'Tacos', ['cumin', 'lime', 'onion']),
        recipe('r2', 'Chili', ['cumin', 'beans', 'onion']),
        recipe('r3', 'Salsa', ['lime', 'tomato']),
      ],
      pantry('onion'),
    );

    const flattened = planMissingByRecipe(matches).flatMap((g) => g.items);
    // Same set, same de-dupe rule, one line per thing to buy.
    expect(new Set(flattened.map((i) => i.key))).toEqual(
      new Set(missingAcross(matches).map((i) => i.key)),
    );
    expect(flattened).toHaveLength(new Set(flattened.map((i) => i.key)).size);
  });

  it('keeps every keyless ingredient, where missingAcross collapses them', () => {
    // Only reachable for a hand-edited document -- toRow() derives a key on read. Dropping
    // a real ingredient off a shopping list is worse than a duplicate row.
    const keyless = (name: string) =>
      ({ key: undefined, name, category: 'other' } as unknown as Item);
    const match = {
      recipe: { id: 'r1' },
      missing: [keyless('a pinch of something'), keyless('another mystery')],
    };

    expect(only(planMissingByRecipe([match])).items).toHaveLength(2);
    expect(
      missingAcross([
        { ...match, have: [], haveCount: 0, missingCount: 2, totalCount: 2, coverage: 0 },
      ]),
    ).toHaveLength(1);
  });
});

describe('countMissing', () => {
  it('totals the rows the button is about to write', () => {
    expect(
      countMissing([
        { recipeId: 'r1', items: [ingredient('cumin'), ingredient('lime')] },
        { recipeId: 'r2', items: [ingredient('beans')] },
      ]),
    ).toBe(3);
  });

  it('is 0 for an empty selection', () => {
    expect(countMissing([])).toBe(0);
  });
});

describe('summarizeAdds', () => {
  it('names the merge, because it is the surprising outcome', () => {
    expect(summarizeAdds([summary(6, 2)])).toBe(
      'Added 6, topped up 2 already on your list.',
    );
  });

  it('adds up several writes into the one sentence the cook earned', () => {
    expect(summarizeAdds([summary(3, 1), summary(2, 0), summary(1, 1)])).toBe(
      'Added 6, topped up 2 already on your list.',
    );
  });

  it('stays quiet about merges when there were none', () => {
    expect(summarizeAdds([summary(4, 0)])).toBe('Added 4.');
  });

  it('does not claim to have added anything when nothing happened', () => {
    expect(summarizeAdds([])).toBe('Nothing to add');
    expect(summarizeAdds([summary(0, 0)])).toBe('Nothing to add');
  });
});
