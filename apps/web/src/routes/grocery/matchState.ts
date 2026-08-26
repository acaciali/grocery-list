import type { Row } from './data';

/**
 * The two questions the list asks about every row's store match, kept pure and apart from
 * the Firestore layer so they can be tested without a database. Both decide whether to
 * throw away or re-fetch a match, so a mistake here quietly destroys good data.
 */

/**
 * Whether a match belongs to a store other than the connected one.
 *
 * Prices, stock and availability are all per-location, so showing store A's price while
 * connected to store B is simply wrong. Two statuses are deliberately exempt:
 *   - 'not_sold' is a statement about the ITEM, not the store. Clearing it would re-flag
 *     "mom's birthday card" at every store, forever.
 *   - 'sent' records something that actually happened. It shows no price in the UI, and
 *     erasing the record would be worse than carrying it across a switch.
 */
export function isStaleMatch(row: Row, locationId: string): boolean {
  const match = row.match;
  if (!match) return false;
  if (match.status === 'not_sold' || match.status === 'unresolved' || match.status === 'sent') {
    return false;
  }
  return match.locationId !== locationId;
}

/**
 * Whether a row is worth a store lookup.
 *
 * Checked items are skipped on purpose: they are already in the basket, and Kroger's
 * product endpoint is capped near 10,000 calls a day across the whole account.
 */
export function needsResolve(row: Row): boolean {
  if (row.checked) return false;
  return row.match == null || row.match.status === 'unresolved';
}
