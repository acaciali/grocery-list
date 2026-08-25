import { describe, expect, it } from 'vitest';
import { normalizeKey } from './items.js';

/**
 * The whiteboard table. PLAN.md Phase 0 asks all three teams to agree on what each of
 * ~15 real ingredient strings normalizes to. Until that happens these are the Inventory
 * team's PROPOSED answers -- change them in the all-hands, not unilaterally.
 */
describe('normalizeKey', () => {
  const agreed: Array<[input: string, expected: string]> = [
    // The load-bearing case: a recipe line and a pantry label must collide.
    ['2 cups whole milk', 'milk'],
    ['Whole Milk', 'milk'],
    ['milk', 'milk'],

    // Quantities and units lead; the thing itself follows.
    ['1 (15 oz) can black beans', 'black-bean'],
    ['3 large eggs', 'egg'],
    ['1/2 cup olive oil', 'olive-oil'],
    ['2 tbsp unsalted butter', 'butter'],

    // A unit word that is NOT a unit here, because it does not lead.
    ['fresh garlic cloves', 'garlic-clove'],
    ['4 cloves garlic', 'garlic'],

    // Plurals collapse.
    ['Tomatoes', 'tomato'],
    ['tomato', 'tomato'],
    ['boneless skinless chicken breasts', 'chicken-breast'],
    ['Strawberries', 'strawberry'],

    // Preparation is not identity.
    ['1 onion, finely chopped', 'onion-finely'],
    ['freshly ground black pepper', 'ground-black-pepper'],

    // Storage state is a descriptor, not identity -- a recipe's "peas" must match
    // the freezer's "frozen peas". The state lives in category/location instead.
    ['frozen peas', 'pea'],
    ['canned tomatoes', 'tomato'],

    // Diacritics and trademark noise.
    ['Jalapeño peppers', 'jalapeno-pepper'],
  ];

  it.each(agreed)('%s -> %s', (input, expected) => {
    expect(normalizeKey(input)).toBe(expected);
  });

  it('is idempotent -- normalizing a key again returns the same key', () => {
    for (const [input] of agreed) {
      const once = normalizeKey(input);
      expect(normalizeKey(once)).toBe(once);
    }
  });

  it('throws rather than returning an empty key', () => {
    expect(() => normalizeKey('   ')).toThrow(/no identifying words/);
    expect(() => normalizeKey('2 cups')).toThrow(/no identifying words/);
  });

  it('does not mistake a word ending in -ss/-us for a plural', () => {
    expect(normalizeKey('molasses')).toBe('molasses');
    expect(normalizeKey('hummus')).toBe('hummus');
    expect(normalizeKey('asparagus')).toBe('asparagus');
  });

  /**
   * ⚠️ OPEN QUESTIONS for the Phase 0 all-hands. These are skipped, not failing, so the
   * suite stays green -- but they are written down so they get decided rather than
   * discovered at 2am during integration.
   */
  describe.skip('unsettled -- decide in the all-hands', () => {
    it('should a brand be stripped so store products match recipe lines?', () => {
      // Currently: 'kroger-milk-gallon', which will NOT match 'milk' from a recipe.
      // Grocery I3 shows the match and lets the user correct it, which may be enough.
      expect(normalizeKey('Kroger® Whole Milk, Gallon')).toBe('milk');
    });

    it('should a trailing prep clause be dropped entirely?', () => {
      // Currently 'onion-finely' -- "finely" survives because only "chopped" is a
      // descriptor. Dropping everything after the comma is the obvious alternative.
      expect(normalizeKey('1 onion, finely chopped')).toBe('onion');
    });

    it('should "ground" be a descriptor or part of the identity?', () => {
      // Ground beef and beef are genuinely different things to buy.
      // Ground pepper and pepper mostly are not.
      expect(normalizeKey('ground beef')).toBe('ground-beef');
      expect(normalizeKey('freshly ground black pepper')).toBe('black-pepper');
    });
  });
});
