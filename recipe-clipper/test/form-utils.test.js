import { describe, expect, it } from 'vitest';
import { UNITS } from '@grocery/shared/types';
import { normalizeKey } from '@grocery/shared/items';
import {
  UNIT_WORD_VALUES,
  arrayToLines,
  buildRecipe,
  formatMinutes,
  isoToMinutes,
  linesToArray,
  parseIngredientLine,
  parseMinutesText,
  parseServings,
} from '../src/form-utils.js';

const STAMP = '<serverTimestamp>';
const opts = { createdAt: STAMP };

describe('linesToArray / arrayToLines', () => {
  it('splits on newlines, trims, drops empty lines', () => {
    expect(linesToArray('  1 cup flour  \n\n2 eggs\n   \nSalt'))
      .toEqual(['1 cup flour', '2 eggs', 'Salt']);
  });

  it('returns an empty array for blank input', () => {
    expect(linesToArray('   ')).toEqual([]);
  });

  it('joins with newlines', () => {
    expect(arrayToLines(['a', 'b', 'c'])).toBe('a\nb\nc');
    expect(arrayToLines([])).toBe('');
  });
});

describe('isoToMinutes', () => {
  it('converts ISO 8601 durations to whole minutes', () => {
    expect(isoToMinutes('PT1H25M')).toBe(85);
    expect(isoToMinutes('PT30M')).toBe(30);
    expect(isoToMinutes('PT2H')).toBe(120);
    expect(isoToMinutes('P1DT2H')).toBe(1560);
  });

  it('is null for blank, zero, and non-ISO text', () => {
    for (const input of [null, '', '  ', 'PT0M', 'PT', '45 minutes', 'P1W']) {
      expect(isoToMinutes(input)).toBeNull();
    }
  });
});

describe('formatMinutes', () => {
  it('renders minutes the way a cook reads them', () => {
    expect(formatMinutes(85)).toBe('1 hr 25 min');
    expect(formatMinutes(120)).toBe('2 hrs');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(1560)).toBe('1 day 2 hrs');
  });

  it('is blank for absent or zero times', () => {
    for (const input of [null, undefined, 0, -5, NaN]) {
      expect(formatMinutes(input)).toBe('');
    }
  });
});

describe('parseMinutesText', () => {
  it('round-trips what formatMinutes produced', () => {
    for (const minutes of [45, 60, 85, 120, 1560]) {
      expect(parseMinutesText(formatMinutes(minutes))).toEqual({ ok: true, value: minutes });
    }
  });

  it('reads a bare number as minutes', () => {
    expect(parseMinutesText('45')).toEqual({ ok: true, value: 45 });
  });

  it('accepts the spellings a cook might type', () => {
    expect(parseMinutesText('1 hour 30 minutes').value).toBe(90);
    expect(parseMinutesText('2h').value).toBe(120);
    expect(parseMinutesText('1.5 hr').value).toBe(90);
  });

  it('reads a pasted ISO duration rather than rejecting it', () => {
    expect(parseMinutesText('PT1H25M')).toEqual({ ok: true, value: 85 });
  });

  it('treats blank and zero as absent', () => {
    expect(parseMinutesText('')).toEqual({ ok: true, value: null });
    expect(parseMinutesText('0')).toEqual({ ok: true, value: null });
  });

  it('rejects rather than coercing text it cannot read', () => {
    expect(parseMinutesText('about an hour').ok).toBe(false);
  });
});

describe('parseServings', () => {
  it('takes the leading count out of whatever the site wrote', () => {
    expect(parseServings('4')).toBe(4);
    expect(parseServings('24 cookies')).toBe(24);
    expect(parseServings('4-6')).toBe(4);
  });

  it('gives up rather than guessing', () => {
    expect(parseServings('')).toBeNull();
    expect(parseServings('Makes a big batch')).toBeNull();
  });
});

describe('parseIngredientLine', () => {
  it('splits a scraped line into quantity, unit, name and key', () => {
    expect(parseIngredientLine('2 cups whole milk')).toEqual({
      key: 'milk',
      name: 'whole milk',
      category: 'other',
      quantity: 2,
      unit: 'cup',
    });
  });

  it('maps unit spellings onto the contract Unit', () => {
    expect(parseIngredientLine('1 lb ground beef').unit).toBe('lb');
    expect(parseIngredientLine('2 tablespoons unsalted butter').unit).toBe('tbsp');
    expect(parseIngredientLine('500 grams flour').unit).toBe('g');
  });

  it('only maps units the shared contract actually has', () => {
    // Drift guard: a Unit renamed in packages/shared fails here instead of writing a value
    // the web app cannot render.
    for (const unit of UNIT_WORD_VALUES) {
      expect(UNITS).toContain(unit);
    }
  });

  it('keeps a measure word with no Unit equivalent in the name', () => {
    // "2 pinches salt" must not become "2 salt".
    expect(parseIngredientLine('2 pinches salt')).toMatchObject({
      name: 'pinches salt',
      quantity: 2,
      unit: null,
    });
  });

  it('handles fractions and ranges', () => {
    expect(parseIngredientLine('1/2 cup olive oil')).toMatchObject({ quantity: 0.5, unit: 'cup' });
    expect(parseIngredientLine('1 1/2 cups flour')).toMatchObject({ quantity: 1.5, unit: 'cup' });
    expect(parseIngredientLine('½ tsp salt')).toMatchObject({ quantity: 0.5, unit: 'tsp' });
    expect(parseIngredientLine('2-3 cloves garlic')).toMatchObject({ quantity: 2, unit: 'clove' });
  });

  it('reads a line with no quantity at all', () => {
    expect(parseIngredientLine('Salt')).toMatchObject({ quantity: null, unit: null });
  });

  it('does not treat a leading unit word as a unit without a number', () => {
    expect(parseIngredientLine('cup of flour').unit).toBeNull();
  });

  it('agrees with shared normalizeKey on the key', () => {
    for (const line of ['2 cups whole milk', '15oz can black beans', '2-3 cloves garlic']) {
      expect(parseIngredientLine(line).key).toBe(normalizeKey(line));
    }
  });

  it('throws when the line is only a measurement', () => {
    expect(() => parseIngredientLine('2 cups')).toThrow();
  });
});

describe('buildRecipe', () => {
  const fields = {
    title: '  Chocolate Chip Cookies  ',
    servings: '24 cookies',
    prepMinutes: '15 min',
    cookMinutes: '10 min',
    totalMinutes: '',
    ingredientsText: '2 cups whole milk\n1 lb ground beef',
    instructionsText: 'Mix.\nBake.',
    sourceUrl: 'https://example.com/cookies',
  };

  it('produces the shared Recipe shape', () => {
    const built = buildRecipe(fields, opts);
    expect(built.ok).toBe(true);
    expect(built.recipe).toEqual({
      title: 'Chocolate Chip Cookies',
      ingredients: [
        { key: 'milk', name: 'whole milk', category: 'other', quantity: 2, unit: 'cup' },
        { key: 'ground-beef', name: 'ground beef', category: 'other', quantity: 1, unit: 'lb' },
      ],
      steps: ['Mix.', 'Bake.'],
      tags: [],
      sourceUrl: 'https://example.com/cookies',
      servings: 24,
      prepMinutes: 15,
      cookMinutes: 10,
      createdBy: 'single-user',
      createdAt: STAMP,
    });
  });

  it('matches the createdBy literal RecipePage writes', () => {
    // These rows have to be findable together when accounts arrive.
    expect(buildRecipe(fields, opts).recipe.createdBy).toBe('single-user');
  });

  it('omits blank optional fields rather than storing empty values', () => {
    const built = buildRecipe({ ...fields, totalMinutes: '  ', sourceUrl: '' }, opts);
    expect('totalMinutes' in built.recipe).toBe(false);
    expect('sourceUrl' in built.recipe).toBe(false);
  });

  it('omits servings when the site gave no number', () => {
    expect('servings' in buildRecipe({ ...fields, servings: 'a batch' }, opts).recipe).toBe(false);
  });

  it('names the time field it could not read', () => {
    const built = buildRecipe({ ...fields, prepMinutes: 'a while' }, opts);
    expect(built).toEqual({ ok: false, msg: 'Prep time is not a time' });
  });

  it('rejects a blank title and an empty ingredient list', () => {
    expect(buildRecipe({ ...fields, title: '  ' }, opts))
      .toEqual({ ok: false, msg: 'Give the recipe a name' });
    expect(buildRecipe({ ...fields, ingredientsText: '\n \n' }, opts))
      .toEqual({ ok: false, msg: 'Add at least one ingredient' });
  });

  it('names the ingredient line that has no identifying words', () => {
    const built = buildRecipe({ ...fields, ingredientsText: '2 cups milk\n2 cups' }, opts);
    expect(built.ok).toBe(false);
    expect(built.msg).toContain('2 cups');
  });

  it('lets a section header through rather than refusing to save', () => {
    // "For the sauce:" keys fine, so it lands as a row the cook deletes on review -- a
    // stray ingredient beats rejecting the whole recipe.
    const built = buildRecipe({ ...fields, ingredientsText: 'For the sauce:\n2 cups milk' }, opts);
    expect(built.ok).toBe(true);
    expect(built.recipe.ingredients).toHaveLength(2);
  });
});
