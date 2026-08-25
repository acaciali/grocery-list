const assert = require('assert');
const { parseRecipe } = require('../src/recipe-parser');

// --- Minimal mock DOM (no jsdom dependency needed) ---
function mockDoc({ ldJsonBlocks = [], itemprops = {}, h1 = null } = {}) {
  const ldScripts = ldJsonBlocks.map(obj => ({ textContent: JSON.stringify(obj) }));

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

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

test('parses a simple JSON-LD Recipe', () => {
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
  assert.strictEqual(recipe.title, 'Chocolate Chip Cookies');
  assert.strictEqual(recipe.servings, '24 cookies');
  assert.deepStrictEqual(recipe.ingredients, ['2 cups flour', '1 cup sugar']);
  assert.deepStrictEqual(recipe.instructions, ['Mix dry ingredients.', 'Bake at 350F.']);
  assert.strictEqual(recipe.sourceUrl, 'https://example.com/recipe');
});

test('finds Recipe nested inside @graph', () => {
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

  const recipe = parseRecipe(doc, 'https://example.com/soup');
  assert.strictEqual(recipe.title, 'Soup');
});

test('handles @type as an array containing "Recipe"', () => {
  const doc = mockDoc({
    ldJsonBlocks: [{
      '@type': ['Recipe', 'Thing'],
      name: 'Stew',
      recipeIngredient: ['Beef'],
      recipeInstructions: ['Simmer.'],
    }],
  });

  const recipe = parseRecipe(doc, 'https://example.com/stew');
  assert.strictEqual(recipe.title, 'Stew');
});

test('flattens HowToStep instruction objects into plain strings', () => {
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

  const recipe = parseRecipe(doc, 'https://example.com/pancakes');
  assert.deepStrictEqual(recipe.instructions, ['Mix batter.', 'Cook on griddle.']);
});

test('falls back to microdata itemprop attributes when no JSON-LD present', () => {
  const doc = mockDoc({
    ldJsonBlocks: [],
    h1: 'Grandma\'s Meatloaf',
    itemprops: {
      recipeIngredient: [el('1 lb ground beef'), el('1 egg')],
      recipeInstructions: [el('Preheat oven.'), el('Mix and bake.')],
    },
  });

  const recipe = parseRecipe(doc, 'https://example.com/meatloaf');
  assert.strictEqual(recipe.title, "Grandma's Meatloaf");
  assert.deepStrictEqual(recipe.ingredients, ['1 lb ground beef', '1 egg']);
  assert.deepStrictEqual(recipe.instructions, ['Preheat oven.', 'Mix and bake.']);
});

test('returns null when no recipe data can be found at all', () => {
  const doc = mockDoc({ ldJsonBlocks: [], itemprops: {} });
  const recipe = parseRecipe(doc, 'https://example.com/not-a-recipe');
  assert.strictEqual(recipe, null);
});

test('ignores malformed JSON-LD blocks and keeps looking', () => {
  const doc = mockDoc({ ldJsonBlocks: [] });
  doc.querySelectorAll = (selector) => {
    if (selector === 'script[type="application/ld+json"]') {
      return [{ textContent: '{not valid json' }];
    }
    return [];
  };
  const recipe = parseRecipe(doc, 'https://example.com/broken');
  assert.strictEqual(recipe, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
