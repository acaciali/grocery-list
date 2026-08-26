/**
 * Text-field → contract-number parsing for the recipe form. Cooks type "1 1/2" and recipe
 * sites emit "1½", but `Item.quantity` and the minute fields want plain numbers.
 *
 * Lives in routes/recipe/ rather than packages/shared because only the recipe form needs
 * it today. Promote it to shared if the import path or Inventory ends up wanting it too.
 */

/** Unicode vulgar fractions, which recipe.md flags as arriving from scraped pages. */
const VULGAR_FRACTIONS = new Map<string, string>([
  ['½', '1/2'], ['⅓', '1/3'], ['⅔', '2/3'],
  ['¼', '1/4'], ['¾', '3/4'],
  ['⅕', '1/5'], ['⅖', '2/5'], ['⅗', '3/5'], ['⅘', '4/5'],
  ['⅙', '1/6'], ['⅚', '5/6'],
  ['⅐', '1/7'], ['⅛', '1/8'], ['⅜', '3/8'], ['⅝', '5/8'], ['⅞', '7/8'],
  ['⅑', '1/9'], ['⅒', '1/10'],
]);

export type QuantityResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };

/** Round to 3 decimals so 1/3 stores as 0.333 rather than a 17-digit float. */
function tidy(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Accepts "2", "1.5", "1/2", "1 1/2", "1½", "½" and blank. Anything else is rejected
 * rather than coerced -- silently turning "a pinch" into null loses the cook's intent.
 */
export function parseQuantity(raw: string): QuantityResult {
  let text = raw.trim();
  if (text === '') return { ok: true, value: null };

  // "1½" -> "1 1/2", bare "½" -> "1/2".
  text = [...text]
    .map((ch) => {
      const expanded = VULGAR_FRACTIONS.get(ch);
      return expanded === undefined ? ch : ` ${expanded} `;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(text);
  if (mixed) {
    const [, whole, numerator, denominator] = mixed;
    const denom = Number(denominator);
    if (denom === 0) return { ok: false, reason: 'divide by zero' };
    return { ok: true, value: tidy(Number(whole) + Number(numerator) / denom) };
  }

  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const [, numerator, denominator] = fraction;
    const denom = Number(denominator);
    if (denom === 0) return { ok: false, reason: 'divide by zero' };
    return { ok: true, value: tidy(Number(numerator) / denom) };
  }

  if (/^\d*\.?\d+$/.test(text)) {
    const value = Number(text);
    if (value < 0) return { ok: false, reason: 'must not be negative' };
    return { ok: true, value: tidy(value) };
  }

  return { ok: false, reason: 'not a number' };
}

/**
 * For servings and the minute fields, which are counts rather than measurements: a
 * positive whole number, or blank for "not stated". Fractions are rejected here on
 * purpose -- half a minute of prep time is noise, not information.
 */
export function parseWholeNumber(raw: string): QuantityResult {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, reason: 'not a whole number' };

  const value = Number(text);
  if (value < 1) return { ok: false, reason: 'must be at least 1' };
  return { ok: true, value };
}

/**
 * The denominators cooking actually uses. A recipe says "3/4 cup", never "0.75 cup", so
 * displaying the stored number raw would be a worse read than what the cook typed in.
 */
const COOKING_FRACTIONS: readonly (readonly [number, number])[] = [
  [1, 2],
  [1, 3], [2, 3],
  [1, 4], [3, 4],
  [1, 5], [2, 5], [3, 5], [4, 5],
  [1, 6], [5, 6],
  [1, 8], [3, 8], [5, 8], [7, 8],
];

/**
 * Wide enough to absorb parseQuantity's 3-decimal rounding (1/3 stores as 0.333, off by
 * 0.00033) and far narrower than the closest gap between two entries above (0.025, between
 * 3/5 and 5/8), so a value can never match the wrong fraction.
 */
const FRACTION_TOLERANCE = 0.005;

/**
 * The display inverse of parseQuantity: 1.5 -> "1 1/2", 0.333 -> "1/3", 2 -> "2".
 *
 * A value that is not a recognizable cooking fraction falls back to a 2-decimal number
 * rather than being forced into the nearest one -- inventing "1/3" for 0.31 would be
 * quietly changing the recipe.
 */
export function formatQuantity(value: number): string {
  const whole = Math.floor(value);
  const remainder = value - whole;

  if (remainder < FRACTION_TOLERANCE) return String(whole);

  for (const [numerator, denominator] of COOKING_FRACTIONS) {
    if (Math.abs(remainder - numerator / denominator) < FRACTION_TOLERANCE) {
      const fraction = `${numerator}/${denominator}`;
      return whole === 0 ? fraction : `${whole} ${fraction}`;
    }
  }

  return String(Math.round(value * 100) / 100);
}
