import { describe, expect, it } from 'vitest';
// Imported for its side effect: recipe-parser.js is a classic script (Chrome injects it as
// one) so it publishes itself on globalThis rather than exporting.
import '../src/recipe-parser.js';

const { parseRecipe } = globalThis;

// --- Minimal mock DOM (no jsdom dependency needed) ---
function mockDoc({ ldJsonBlocks = [], itemprops = {}, h1 = null } = {}) {
  const ldScripts = ldJsonBlocks.map((obj) => ({ textContent: JSON.stringify(obj) }));

  return {
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return ldScripts;
      const match = selector.match(/^\[itemprop="(.+)"\]$/);
      if (match) return itemprops[match[1]] || [];
      return [];
    },
    querySelector(selector) {
      if (selector === 'h1') return h1 ? { textContent: h1 } : null;
      const match = selector.match(/^\[itemprop="(.+)"\]$/);
      if (match) return (itemprops[match[1]] || [])[0] || null;
      return null;
    },
  };
}

function el(text, attrs = {}) {
  return { textContent: text, getAttribute: (name) => attrs[name] || null };
}

describe('parseRecipe', () => {
  it('parses a simple JSON-LD Recipe', () => {
    const doc = mockDoc({
      ldJsonBlocks: [{
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'Chocolate Chip Cookies',
        recipeYield: '24 cookies',
        prepTime: 'PT15M',
        cookTime: 'PT10M',
        recipeIngredient: ['2 cups flour', '1 cup sugar'],
        recipeInstructions: ['Mix dry ingredients.', 'Bake at 350F.'],
      }],
    });

    const recipe = parseRecipe(doc, 'https://example.com/recipe');
    expect(recipe.title).toBe('Chocolate Chip Cookies');
    expect(recipe.servings).toBe('24 cookies');
    expect(recipe.ingredients).toEqual(['2 cups flour', '1 cup sugar']);
    expect(recipe.instructions).toEqual(['Mix dry ingredients.', 'Bake at 350F.']);
    expect(recipe.sourceUrl).toBe('https://example.com/recipe');
  });

  it('finds Recipe nested inside @graph', () => {
    const doc = mockDoc({
      ldJsonBlocks: [{
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Some Site' },
          {
            '@type': 'Recipe',
            name: 'Soup',
            recipeIngredient: ['Water'],
            recipeInstructions: ['Boil it.'],
          },
        ],
      }],
    });

    expect(parseRecipe(doc, 'https://example.com/soup').title).toBe('Soup');
  });

  it('handles @type as an array containing "Recipe"', () => {
    const doc = mockDoc({
      ldJsonBlocks: [{
        '@type': ['Recipe', 'Thing'],
        name: 'Stew',
        recipeIngredient: ['Beef'],
        recipeInstructions: ['Simmer.'],
      }],
    });

    expect(parseRecipe(doc, 'https://example.com/stew').title).toBe('Stew');
  });

  it('flattens HowToStep instruction objects into plain strings', () => {
    const doc = mockDoc({
      ldJsonBlocks: [{
        '@type': 'Recipe',
        name: 'Pancakes',
        recipeIngredient: ['Flour'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Mix batter.' },
          { '@type': 'HowToStep', text: 'Cook on griddle.' },
        ],
      }],
    });

    expect(parseRecipe(doc, 'https://example.com/pancakes').instructions)
      .toEqual(['Mix batter.', 'Cook on griddle.']);
  });

  it('falls back to microdata itemprop attributes when no JSON-LD present', () => {
    const doc = mockDoc({
      ldJsonBlocks: [],
      h1: "Grandma's Meatloaf",
      itemprops: {
        recipeIngredient: [el('1 lb ground beef'), el('1 egg')],
        recipeInstructions: [el('Preheat oven.'), el('Mix and bake.')],
      },
    });

    const recipe = parseRecipe(doc, 'https://example.com/meatloaf');
    expect(recipe.title).toBe("Grandma's Meatloaf");
    expect(recipe.ingredients).toEqual(['1 lb ground beef', '1 egg']);
    expect(recipe.instructions).toEqual(['Preheat oven.', 'Mix and bake.']);
  });

  it('returns null when no recipe data can be found at all', () => {
    const doc = mockDoc({ ldJsonBlocks: [], itemprops: {} });
    expect(parseRecipe(doc, 'https://example.com/not-a-recipe')).toBeNull();
  });

  it('ignores malformed JSON-LD blocks and keeps looking', () => {
    const doc = mockDoc({ ldJsonBlocks: [] });
    doc.querySelectorAll = (selector) =>
      selector === 'script[type="application/ld+json"]'
        ? [{ textContent: '{not valid json' }]
        : [];
    expect(parseRecipe(doc, 'https://example.com/broken')).toBeNull();
  });
});
