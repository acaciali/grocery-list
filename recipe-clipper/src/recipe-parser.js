/**
 * Pure recipe-extraction logic. Takes a `document`-like object so it can be
 * unit tested without a browser, and reused unmodified inside the bookmarklet.
 */

function textOf(el) {
  return el && el.textContent ? el.textContent.trim() : '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenInstructions(instructions) {
  const items = asArray(instructions);
  const steps = [];
  for (const item of items) {
    if (typeof item === 'string') {
      steps.push(item.trim());
    } else if (item && typeof item === 'object') {
      if (item['@type'] === 'HowToSection' && item.itemListElement) {
        steps.push(...flattenInstructions(item.itemListElement));
      } else if (item.text) {
        steps.push(String(item.text).trim());
      }
    }
  }
  return steps.filter(Boolean);
}

function isRecipeType(type) {
  return asArray(type).includes('Recipe');
}

function findRecipeInJsonLd(node) {
  if (!node || typeof node !== 'object') return null;
  if (isRecipeType(node['@type'])) return node;
  if (Array.isArray(node['@graph'])) {
    for (const child of node['@graph']) {
      const found = findRecipeInJsonLd(child);
      if (found) return found;
    }
  }
  return null;
}

function extractJsonLdRecipe(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch (e) {
      continue; // malformed block, keep looking
    }
    const candidates = Array.isArray(data) ? data : [data];
    for (const candidate of candidates) {
      const recipe = findRecipeInJsonLd(candidate);
      if (recipe) {
        return {
          title: recipe.name || null,
          servings: recipe.recipeYield ? String(asArray(recipe.recipeYield)[0]) : null,
          prepTime: recipe.prepTime || null,
          cookTime: recipe.cookTime || null,
          totalTime: recipe.totalTime || null,
          ingredients: asArray(recipe.recipeIngredient).map(String),
          instructions: flattenInstructions(recipe.recipeInstructions),
        };
      }
    }
  }
  return null;
}

function extractMicrodataRecipe(doc) {
  const ingredientEls = doc.querySelectorAll('[itemprop="recipeIngredient"]');
  const instructionEls = doc.querySelectorAll('[itemprop="recipeInstructions"]');
  if (ingredientEls.length === 0 && instructionEls.length === 0) return null;

  const titleEl = doc.querySelector('[itemprop="name"]') || doc.querySelector('h1');

  return {
    title: textOf(titleEl) || null,
    servings: null,
    prepTime: null,
    cookTime: null,
    totalTime: null,
    ingredients: Array.from(ingredientEls).map(textOf).filter(Boolean),
    instructions: Array.from(instructionEls).map(textOf).filter(Boolean),
  };
}

function parseRecipe(doc, sourceUrl) {
  const found = extractJsonLdRecipe(doc) || extractMicrodataRecipe(doc);
  if (!found) return null;
  if (!found.title && found.ingredients.length === 0 && found.instructions.length === 0) {
    return null;
  }
  return { ...found, sourceUrl };
}

if (typeof module !== 'undefined') {
  module.exports = { parseRecipe };
}
