/**
 * Turns what the cook sees in the popup into the `Recipe` shape from packages/shared, and
 * back again. Pure -- no DOM, no Firestore -- so every rule below is unit tested.
 */
import { normalizeKey } from '@grocery/shared/items';

/**
 * `Recipe.createdBy` is a required string and the app has no auth. RecipePage.tsx uses this
 * exact literal for the same reason, and the two MUST match: when accounts arrive, these
 * rows are found by this value, and a clipper that wrote something else would be missed.
 */
const SINGLE_USER = 'single-user';

export function linesToArray(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function arrayToLines(arr) {
  return (arr || []).join('\n');
}

// --- times -----------------------------------------------------------------------------
//
// The contract stores whole minutes (`prepMinutes` etc.) so times sort and add without
// re-parsing. Recipe sites emit ISO 8601 ("PT1H25M"), and types.ts says "the import path
// converts" -- this is that import path. The form still SHOWS "1 hr 25 min", because
// "85" in a prep-time box is not something a cook reads, so the value round-trips:
// ISO -> minutes -> friendly text -> (cook may edit) -> minutes.

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** 'PT1H25M' -> 85. Null for blank, zero durations, and anything not ISO 8601. */
export function isoToMinutes(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === '') return null;
  const m = ISO_DURATION.exec(raw);
  if (!m) return null;
  const total =
    Number(m[1] || 0) * 1440 +
    Number(m[2] || 0) * 60 +
    Number(m[3] || 0) +
    Math.round(Number(m[4] || 0) / 60);
  return total > 0 ? total : null;
}

/** 85 -> '1 hr 25 min'. Blank for null/zero, so an absent time shows an empty field. */
export function formatMinutes(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(' ');
}

/**
 * '1 hr 25 min' -> 85, and a bare '45' means 45 minutes. Rejects rather than coerces, the
 * same way parseQuantity does in routes/recipe: turning "about an hour" into null would
 * silently drop what the cook typed, and turning it into 0 would be a lie.
 */
export function parseMinutesText(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (text === '') return { ok: true, value: null };

  // A cook who pastes the raw site value gets it read rather than rejected.
  if (ISO_DURATION.test(text.toUpperCase())) return { ok: true, value: isoToMinutes(text) };

  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return { ok: true, value: value > 0 ? value : null };
  }

  const m = /^(?:([\d.]+)\s*(?:d|days?)\s*)?(?:([\d.]+)\s*(?:h|hrs?|hours?)\s*)?(?:([\d.]+)\s*(?:m|mins?|minutes?))?$/
    .exec(text);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    return { ok: false, reason: 'not a time' };
  }
  const total = Math.round(
    Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0),
  );
  return { ok: true, value: total > 0 ? total : null };
}

// --- ingredients -----------------------------------------------------------------------

/** Round to 3 decimals -- matches tidy() in routes/recipe/quantity.ts so the two surfaces
 *  store the same number for the same half-cup. */
function tidy(n) {
  return Math.round(n * 1000) / 1000;
}

/** Same table as routes/recipe/quantity.ts. Duplicated rather than imported: reaching into
 *  another team's route folder from an extension is worse coupling than 18 static lines. */
const VULGAR_FRACTIONS = new Map([
  ['½', '1/2'], ['⅓', '1/3'], ['⅔', '2/3'],
  ['¼', '1/4'], ['¾', '3/4'],
  ['⅕', '1/5'], ['⅖', '2/5'], ['⅗', '3/5'], ['⅘', '4/5'],
  ['⅙', '1/6'], ['⅚', '5/6'],
  ['⅐', '1/7'], ['⅛', '1/8'], ['⅜', '3/8'], ['⅝', '5/8'], ['⅞', '7/8'],
  ['⅑', '1/9'], ['⅒', '1/10'],
]);

function expandFractions(text) {
  return [...text]
    .map((ch) => (VULGAR_FRACTIONS.has(ch) ? ` ${VULGAR_FRACTIONS.get(ch)} ` : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that map onto a contract `Unit`. Only the twelve the contract has: a measure with
 * no Unit ("2 pinches salt") keeps its word in the NAME, because "2 salt" would be a lie.
 */
const UNIT_WORDS = new Map([
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['kg', 'kg'], ['kilo', 'kg'], ['kilos', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['oz', 'oz'], ['ounce', 'oz'], ['ounces', 'oz'],
  ['lb', 'lb'], ['lbs', 'lb'], ['pound', 'lb'], ['pounds', 'lb'],
  ['ml', 'ml'], ['milliliter', 'ml'], ['milliliters', 'ml'],
  ['l', 'l'], ['liter', 'l'], ['liters', 'l'], ['litre', 'l'], ['litres', 'l'],
  ['tsp', 'tsp'], ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
  ['tbsp', 'tbsp'], ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'],
  ['cup', 'cup'], ['cups', 'cup'],
  ['clove', 'clove'], ['cloves', 'clove'],
  ['can', 'can'], ['cans', 'can'],
  ['pkg', 'pkg'], ['package', 'pkg'], ['packages', 'pkg'],
  ['packet', 'pkg'], ['packets', 'pkg'],
]);
export const UNIT_WORD_VALUES = [...new Set(UNIT_WORDS.values())];

/** Peel a leading quantity off a scraped line. Ranges collapse to the low end -- the cook
 *  can always add more, and we have not invented a quantityMax nobody reads. */
function takeLeadingQuantity(line) {
  const text = expandFractions(line);
  const mixed = /^(\d+)\s+(\d+)\/(\d+)(?=\s|$)/.exec(text);
  if (mixed) {
    const denom = Number(mixed[3]);
    if (denom !== 0) {
      return {
        quantity: tidy(Number(mixed[1]) + Number(mixed[2]) / denom),
        rest: text.slice(mixed[0].length).trim(),
      };
    }
  }
  const fraction = /^(\d+)\/(\d+)(?=\s|$)/.exec(text);
  if (fraction) {
    const denom = Number(fraction[2]);
    if (denom !== 0) {
      return {
        quantity: tidy(Number(fraction[1]) / denom),
        rest: text.slice(fraction[0].length).trim(),
      };
    }
  }
  const range = /^(\d*\.?\d+)\s*(?:[-–—]|to)\s*\d*\.?\d+(?=\s|$)/.exec(text);
  if (range) {
    return { quantity: tidy(Number(range[1])), rest: text.slice(range[0].length).trim() };
  }
  // Plain number, optionally glued to its unit: the "15" of "15oz".
  const plain = /^(\d*\.?\d+)(?=\s|$|[a-zA-Z])/.exec(text);
  if (plain) {
    return { quantity: tidy(Number(plain[1])), rest: text.slice(plain[0].length).trim() };
  }
  return { quantity: null, rest: text };
}

/**
 * One scraped line -> one Item. "2 cups whole milk" becomes
 * { key: 'milk', name: 'whole milk', category: 'other', quantity: 2, unit: 'cup' }.
 *
 * `key` comes from normalizeKey on the WHOLE original line, not the trimmed name:
 * normalizeKey already strips leading quantities and units, and feeding it the full line
 * keeps this from becoming a second, subtly different opinion about what a key is.
 *
 * THROWS when nothing identifying survives ("2 cups" on its own), which is normalizeKey's
 * own contract. buildRecipe catches per line so it can name the line to fix.
 *
 * `category` is always 'other': there is no category inference anywhere in the product, and
 * Item requires the field. Same placeholder RecipePage uses.
 */
export function parseIngredientLine(line) {
  const raw = line.trim();
  const key = normalizeKey(raw); // throws first, before we bother parsing numbers

  const { quantity, rest } = takeLeadingQuantity(raw);

  // A unit is only a unit directly after a quantity. "cup of flour" is prose, and reading
  // 'cup' there would invent a quantity of one.
  let unit = null;
  let name = rest;
  if (quantity !== null) {
    const [first = '', ...others] = rest.split(/\s+/);
    const mapped = UNIT_WORDS.get(first.toLowerCase().replace(/[^a-z]/g, ''));
    if (mapped !== undefined) {
      unit = mapped;
      name = others.join(' ');
    }
  }

  return {
    key,
    // Fall back to the whole line rather than an empty display name.
    name: name.trim() === '' ? raw : name.trim(),
    category: 'other',
    quantity,
    unit,
  };
}

/**
 * `servings` is a number, but sites write "24 cookies", "4-6", "Makes 4". Take the leading
 * count and give up when there isn't one -- a wrong serving count is worse than a missing
 * one, and the cook can type it in.
 */
export function parseServings(value) {
  const match = /^(\d+)/.exec(String(value || '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

/**
 * Build the document to write to `recipes`.
 *
 * `createdAt` is injected rather than called here so this file stays free of the Firestore
 * SDK: the popup passes serverTimestamp(), tests pass a sentinel.
 *
 * Returns a result rather than throwing, because every failure is something the cook can fix
 * in the form. Reporting WHICH field or line is the whole point.
 */
export function buildRecipe(fields, { createdAt }) {
  const title = String(fields.title || '').trim();
  if (title === '') return { ok: false, msg: 'Give the recipe a name' };

  const lines = linesToArray(fields.ingredientsText);
  if (lines.length === 0) return { ok: false, msg: 'Add at least one ingredient' };

  const ingredients = [];
  for (const line of lines) {
    try {
      ingredients.push(parseIngredientLine(line));
    } catch {
      // normalizeKey threw: nothing identifying survived, in practice a line that is only a
      // measurement. Section headers do NOT land here -- they have words, so they key fine
      // and the cook deletes them on the review screen.
      return { ok: false, msg: `“${line}” needs a more specific ingredient name` };
    }
  }

  const times = {};
  for (const [field, label] of [
    ['prepMinutes', 'Prep time'],
    ['cookMinutes', 'Cook time'],
    ['totalMinutes', 'Total time'],
  ]) {
    const parsed = parseMinutesText(fields[field]);
    if (!parsed.ok) return { ok: false, msg: `${label} is ${parsed.reason}` };
    if (parsed.value !== null) times[field] = parsed.value;
  }

  const servings = parseServings(fields.servings);
  const sourceUrl = String(fields.sourceUrl || '').trim();

  return {
    ok: true,
    recipe: {
      title,
      ingredients,
      steps: linesToArray(fields.instructionsText),
      tags: [],
      ...(sourceUrl === '' ? {} : { sourceUrl }),
      ...(servings === null ? {} : { servings }),
      ...times,
      createdBy: SINGLE_USER,
      createdAt,
    },
  };
}
