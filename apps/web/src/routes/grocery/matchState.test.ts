import { describe, expect, it } from 'vitest';
import type { MatchStatus, StoreMatch } from '@grocery/shared';
import { isStaleMatch, needsResolve } from './matchState';
import type { Row } from './data';

const STORE_A = 'loc-a';
const STORE_B = 'loc-b';

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'r1',
    name: 'milk',
    checked: false,
    createdAt: null as unknown as Row['createdAt'],
    ...over,
  };
}

const match = (status: MatchStatus, locationId: string | null): StoreMatch => ({
  status,
  locationId,
});

describe('isStaleMatch', () => {
  it('is stale when the match belongs to another store', () => {
    expect(isStaleMatch(row({ match: match('matched', STORE_A) }), STORE_B)).toBe(true);
    expect(isStaleMatch(row({ match: match('ambiguous', STORE_A) }), STORE_B)).toBe(true);
    expect(isStaleMatch(row({ match: match('unavailable', STORE_A) }), STORE_B)).toBe(true);
    expect(isStaleMatch(row({ match: match('no_match', STORE_A) }), STORE_B)).toBe(true);
  });

  it('is not stale at the store it was matched against', () => {
    expect(isStaleMatch(row({ match: match('matched', STORE_A) }), STORE_A)).toBe(false);
  });

  it("keeps 'not_sold' across stores -- it describes the item, not the store", () => {
    expect(isStaleMatch(row({ match: match('not_sold', null) }), STORE_B)).toBe(false);
  });

  it("keeps 'sent' -- it is a record of something that happened", () => {
    expect(isStaleMatch(row({ match: match('sent', STORE_A) }), STORE_B)).toBe(false);
  });

  it('leaves rows with no match alone', () => {
    expect(isStaleMatch(row(), STORE_B)).toBe(false);
    expect(isStaleMatch(row({ match: match('unresolved', null) }), STORE_B)).toBe(false);
  });
});

describe('needsResolve', () => {
  it('resolves rows that have never been looked up', () => {
    expect(needsResolve(row())).toBe(true);
    expect(needsResolve(row({ match: match('unresolved', null) }))).toBe(true);
  });

  it('leaves rows that already have an answer', () => {
    for (const status of ['matched', 'ambiguous', 'unavailable', 'no_match', 'not_sold', 'sent'] as const) {
      expect(needsResolve(row({ match: match(status, STORE_A) }))).toBe(false);
    }
  });

  it('skips checked rows -- already in the basket, and lookups are rate limited', () => {
    expect(needsResolve(row({ checked: true }))).toBe(false);
  });
});
