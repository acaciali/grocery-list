import type { Unit } from '@grocery/shared';

/**
 * Pulls a leading quantity off what someone typed: "2 gal milk" -> 2 gal + "milk".
 *
 * Known limitation: a product whose name starts with a bare number parses as a quantity,
 * so "7 Up" becomes 7 x "Up". It is rare, immediately visible on the row, and editable;
 * the alternative heuristics (require a lowercase next word, keep a stoplist) all break
 * the far more common "2 apples".
 *
 * Deliberately local to Grocery rather than added to packages/shared. CLAUDE.md specifies
 * a shared parseIngredientLine() for recipe lines, which does not exist yet and is the
 * Recipe team's to define; a list entry is a simpler, different input and does not need
 * to wait on it. Fold this in later if the two turn out to be the same function.
 */

const UNIT_WORDS: Record<string, Unit> = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can',
  pkg: 'pkg', package: 'pkg', packages: 'pkg', pack: 'pkg', packs: 'pkg',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  dozen: 'dozen', doz: 'dozen',
  bunch: 'bunch', bunches: 'bunch',
  bag: 'bag', bags: 'bag',
  ea: 'each', each: 'each',
};

export interface ParsedEntry {
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

/** "1 1/2", "1.5", "2" -> number. Returns null for anything else. */
function parseNumber(token: string, next: string | undefined): { value: number; consumed: number } | null {
  const mixed = /^(\d+)$/.exec(token);
  if (mixed && next && /^\d+\/\d+$/.test(next)) {
    const [n, d] = next.split('/').map(Number) as [number, number];
    return d ? { value: Number(mixed[1]) + n / d, consumed: 2 } : null;
  }
  if (/^\d+\/\d+$/.test(token)) {
    const [n, d] = token.split('/').map(Number) as [number, number];
    return d ? { value: n / d, consumed: 1 } : null;
  }
  if (/^\d+(\.\d+)?$/.test(token)) return { value: Number(token), consumed: 1 };
  return null;
}

export function parseEntry(raw: string): ParsedEntry {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { name: raw.trim(), quantity: null, unit: null };

  let i = 0;
  let quantity: number | null = null;
  let unit: Unit | null = null;

  // "a dozen eggs" / "an onion" -- the article is a quantity word, not part of the name.
  if (/^an?$/i.test(tokens[0] ?? '')) {
    i = 1;
    quantity = 1;
  }

  const num = parseNumber(tokens[i] ?? '', tokens[i + 1]);
  if (num) {
    quantity = num.value;
    i += num.consumed;
  }

  // A bare unit with no number still means one of them: "dozen eggs", "bag of rice".
  const unitWord = tokens[i]?.toLowerCase().replace(/\.$/, '');
  if (unitWord && unitWord in UNIT_WORDS) {
    unit = UNIT_WORDS[unitWord] ?? null;
    i += 1;
    if (quantity === null) quantity = 1;
    if (tokens[i]?.toLowerCase() === 'of') i += 1;
  }

  const name = tokens.slice(i).join(' ');
  // "2%" and "7 Up" are names, not quantities -- if stripping left nothing, keep it all.
  if (name.length === 0) return { name: raw.trim(), quantity: null, unit: null };

  return { name, quantity, unit };
}
