import type { StoreMatch, StoreProduct } from '../types.js';

/**
 * How confident we must be to pick a product without asking, plus how far ahead of the
 * runner-up it has to be. Both are deliberately strict: a silently wrong match is worse
 * than one extra tap, because the user finds out at the checkout, not in the app.
 */
const AUTO_ACCEPT_SCORE = 0.8;
const AUTO_ACCEPT_GAP = 0.15;

const STOPWORDS = new Set(['of', 'the', 'a', 'an', 'and', 'with']);

function tokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Cheap stem so "eggs"/"egg" and "berries"/"berry" line up without a stemmer library. */
function stem(t: string): string {
  if (t.length > 3 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('es') && /(s|x|z|ch|sh)$/.test(t.slice(0, -2))) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/**
 * 0-1, how well a product answers the query.
 *
 * Coverage dominates on purpose: a product is a good answer when it accounts for every
 * word you typed. Brand tokens on the product side are NOT penalised -- "Kroger 2%
 * Reduced Fat Milk" is a perfectly good answer to "2% milk", and the extra words are the
 * store being specific, not the match being wrong.
 */
export function score(query: string, product: StoreProduct, rank: number): number {
  const q = tokens(query).map(stem);
  if (q.length === 0) return 0;
  const name = new Set(tokens(`${product.brand ?? ''} ${product.name}`).map(stem));

  const covered = q.filter((t) => name.has(t)).length / q.length;

  // Rank is the store's own relevance opinion; worth a nudge, never a decision.
  const rankBonus = Math.max(0, 0.05 - rank * 0.01);

  // A product with no price at this location usually means it isn't really carried here.
  const stocked = product.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? -0.05 : 0;

  return Math.max(0, Math.min(1, covered + rankBonus + stocked));
}

export interface Scored {
  product: StoreProduct;
  score: number;
}

export function rank(query: string, products: StoreProduct[]): Scored[] {
  return products
    .map((product, i) => ({ product, score: score(query, product, i) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Turn a ranked candidate list into the match we store. Every branch here is a state the
 * UI renders differently, which is the point -- "found nothing" and "found it but the
 * store is out" are different problems with different fixes.
 */
export function toMatch(
  query: string,
  products: StoreProduct[],
  locationId: string,
): StoreMatch {
  const ranked = rank(query, products);
  const top = ranked[0];

  if (!top || top.score === 0) {
    return { status: 'no_match', locationId, product: null, candidates: [], confidence: 0 };
  }

  const second = ranked[1]?.score ?? 0;
  const confident = top.score >= AUTO_ACCEPT_SCORE && top.score - second >= AUTO_ACCEPT_GAP;
  const candidates = ranked.slice(0, 5).map((r) => r.product);

  if (!confident) {
    return {
      status: 'ambiguous',
      locationId,
      product: null,
      candidates,
      confidence: top.score,
      chosenBy: null,
    };
  }

  return {
    status: top.product.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? 'unavailable' : 'matched',
    locationId,
    product: top.product,
    candidates,
    confidence: top.score,
    chosenBy: 'auto',
    cartQuantity: 1,
    resolvedAt: null,
    sentAt: null,
  };
}

/**
 * The match for a product this user already picked for this exact text.
 *
 * Confidence is 1 and there are no candidates on purpose: this is not the resolver having
 * an opinion, it is the user's own earlier decision being replayed. Stock is still checked,
 * because "you chose this" and "the store has it today" are different facts.
 */
export function fromRemembered(product: StoreProduct, locationId: string): StoreMatch {
  return {
    status: product.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? 'unavailable' : 'matched',
    locationId,
    product,
    confidence: 1,
    chosenBy: 'memory',
    cartQuantity: 1,
  };
}

export { AUTO_ACCEPT_GAP, AUTO_ACCEPT_SCORE };
