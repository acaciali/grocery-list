/**
 * ⭐ normalizeKey() -- the join column of the entire product.
 *
 * It is how a recipe's "2 cups whole milk" matches inventory's "Whole milk" matches
 * Kroger's "Kroger® Whole Milk Gallon".
 *
 * ============================================================================
 * ⚠️  PROPOSED -- PENDING ALL-HANDS SIGN-OFF
 *
 * PLAN.md Phase 0 calls the "whiteboard 15 real ingredient strings and agree on what each
 * normalizes to" conversation the single highest-leverage hour of the project. That
 * conversation has NOT happened yet.
 *
 * This implementation exists so the Inventory data layer can be built today. It is
 * deliberately conservative. The open questions are written down as skipped cases in
 * items.test.ts -- settle them in the all-hands, then change this in one PR.
 *
 * The biggest unsettled question: BRAND STRIPPING. "Kroger® Whole Milk" currently keeps
 * "kroger" as part of the key, so it will NOT match a recipe's "whole milk". Stripping
 * brands needs a brand list we do not have, and guessing (drop the first token?) would
 * mangle "chicken breast". Grocery's I3 confirm-the-match step is the intended safety net.
 * ============================================================================
 */
import type { ItemKey } from './types.js';

/**
 * Measurement words dropped only when they LEAD the string, where they are quantities
 * rather than the thing itself. "1 clove garlic" drops the clove; "garlic cloves" keeps it.
 */
const LEADING_UNITS = new Set([
  'g', 'gram', 'grams',
  'kg', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds',
  'ml', 'milliliter', 'milliliters',
  'l', 'liter', 'liters', 'litre', 'litres',
  'tsp', 'teaspoon', 'teaspoons',
  'tbsp', 'tablespoon', 'tablespoons',
  'cup', 'cups',
  'clove', 'cloves',
  'can', 'cans',
  'pkg', 'package', 'packages', 'packet', 'packets',
  'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons',
  'bunch', 'bunches', 'head', 'heads',
  'slice', 'slices', 'stick', 'sticks',
  'pinch', 'pinches', 'dash', 'dashes',
  'jar', 'jars', 'bottle', 'bottles', 'bag', 'bags', 'box', 'boxes',
]);

/** Words that describe a thing without changing WHICH thing it is. */
const DESCRIPTORS = new Set([
  'a', 'an', 'the', 'of', 'and',
  'fresh', 'freshly', 'organic', 'raw', 'ripe', 'frozen', 'canned', 'dried',
  'large', 'small', 'medium', 'extra', 'jumbo',
  'whole', 'halved', 'chopped', 'diced', 'minced', 'sliced', 'shredded',
  'grated', 'crushed', 'peeled', 'trimmed', 'rinsed', 'drained',
  'boneless', 'skinless', 'unsalted', 'salted', 'plain',
  'optional', 'divided', 'packed', 'softened', 'melted',
]);

/**
 * Plurals ending in -ies whose singular ends in -ie, not -y.
 * "berries" -> "berry" is the general rule; "cookies" -> "cooky" is not a word.
 * English cannot tell these apart without a dictionary, so the -ie words we actually
 * meet in a kitchen are listed instead.
 */
const IE_PLURALS = new Set([
  'cookies', 'brownies', 'twinkies', 'smoothies', 'veggies',
  'hoagies', 'pierogies', 'blondies', 'zeppolies',
]);

/** Words whose trailing -s or -es is part of the word, not a plural. */
const INVARIANT = new Set([
  'molasses', 'hummus', 'couscous', 'asparagus', 'watercress', 'swiss',
  'grits', 'oats', 'greens', 'sprouts', 'grass',
]);

function isQuantityToken(token: string): boolean {
  if (/^\d+$/.test(token)) return true;
  // Glued forms like "15oz" that survived punctuation stripping.
  const glued = /^\d+([a-z]+)$/.exec(token);
  return glued !== null && LEADING_UNITS.has(glued[1] ?? '');
}

function singularize(token: string): string {
  if (INVARIANT.has(token)) return token;
  if (token.length <= 3) return token;

  if (IE_PLURALS.has(token)) return token.slice(0, -1);
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('oes')) return token.slice(0, -2);

  if (token.endsWith('es')) {
    const stem = token.slice(0, -2);
    // "molasses" -> stem "molass": a doubled s means the es is not a plural marker.
    if (stem.endsWith('ss')) return token;
    if (/(s|x|z|ch|sh)$/.test(stem)) return stem;
  }

  if (token.endsWith('s') && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/**
 * The only source of ItemKey. Every path into the product -- manual entry, recipe import,
 * shelf photo, barcode lookup -- runs its display name through here, which is why a
 * photographed pantry matches a scraped recipe for free.
 */
export function normalizeKey(raw: string): ItemKey {
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')       // drop parenthetical asides
    .replace(/[^a-z0-9\s]/g, ' ')     // punctuation, ®, ™, fraction slashes
    .trim();

  let tokens = cleaned.split(/\s+/).filter(Boolean);

  // Leading quantity + unit run only. Stop at the first real word.
  let start = 0;
  while (start < tokens.length) {
    const token = tokens[start] ?? '';
    if (isQuantityToken(token) || LEADING_UNITS.has(token)) start += 1;
    else break;
  }
  tokens = tokens.slice(start);

  // Descriptors, unless dropping them would leave nothing ("whole" on its own).
  const withoutDescriptors = tokens.filter((t) => !DESCRIPTORS.has(t));
  if (withoutDescriptors.length > 0) tokens = withoutDescriptors;

  tokens = tokens.map(singularize).filter(Boolean);

  const key = tokens.join('-');
  if (key.length === 0) {
    throw new Error(
      `normalizeKey: "${raw}" has no identifying words left after normalizing. ` +
        'A keyless item cannot be stored or matched -- validate before calling.',
    );
  }
  return key as ItemKey;
}

/**
 * Re-brand a string that is ALREADY a normalized key -- e.g. one read back out of
 * Firestore, where it round-trips as a plain string.
 *
 * Do not use this to skip normalizeKey() on user or model input. That is exactly the
 * mistake the brand exists to prevent.
 */
export function asItemKey(alreadyNormalized: string): ItemKey {
  return alreadyNormalized as ItemKey;
}
