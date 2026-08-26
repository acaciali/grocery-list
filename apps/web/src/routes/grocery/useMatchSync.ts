import { useEffect, useRef, useState } from 'react';
import type { StoreMatch } from '@grocery/shared';
import { RESOLVE_BATCH_LIMIT, resolveItems } from './api';
import { resetMatches, setMatch, type Row } from './data';
import { isStaleMatch, needsResolve } from './matchState';

/**
 * Keeps the list's store matches in step with the connected store.
 *
 * Two jobs, in this order:
 *   1. Anything matched against a different store is dropped back to 'unresolved', so a
 *      switch can never leave another store's prices on screen.
 *   2. Anything unresolved is batch-resolved. Type-ahead only covers items typed into the
 *      grocery input; items written by Recipe (I1) and Inventory (I2) never touch it and
 *      would otherwise stay unresolved forever.
 *
 * The in-flight 'resolving' state is returned, not written to Firestore. It is a fact about
 * this tab's network request, and persisting it would strand rows mid-spinner whenever a
 * tab closes at the wrong moment.
 */

function summarize(matches: StoreMatch[]): string {
  const parts: string[] = [];
  const count = (status: StoreMatch['status']) =>
    matches.filter((m) => m.status === status).length;

  const matched = count('matched');
  const choose = count('ambiguous') + count('unavailable');
  const missing = count('no_match');

  if (matched > 0) parts.push(`${matched} matched`);
  if (choose > 0) parts.push(`${choose} need a choice`);
  if (missing > 0) parts.push(`${missing} not found at this store`);
  if (parts.length === 0) return '';

  const n = matches.length;
  return `Checked ${n} item${n === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

export interface MatchSync {
  /** Rows whose lookup is in flight right now. */
  resolvingIds: ReadonlySet<string>;
  /** For an aria-live region -- background matching is otherwise invisible. */
  announcement: string;
  /** Rows dropped by the most recent store switch, until acknowledged. */
  staleCount: number;
  dismissStale: () => void;
  /**
   * Re-arm one row for resolution. Needed because a row the user sends back to
   * 'unresolved' ("check the store again") is already in the attempted set, and would
   * otherwise sit there until the next page load.
   */
  retry: (id: string) => void;
}

export function useMatchSync(
  items: Row[],
  locationId: string | null,
  uid: string | null,
): MatchSync {
  const [resolvingIds, setResolvingIds] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [staleCount, setStaleCount] = useState(0);

  // Ids already sent this session, so a failed or fruitless lookup is not retried on every
  // snapshot. Cleared on a store switch, where the same item deserves a fresh answer.
  const attempted = useRef(new Set<string>());
  const invalidating = useRef(false);
  const resolving = useRef(false);

  useEffect(() => {
    attempted.current.clear();
    setStaleCount(0);
    setAnnouncement('');
  }, [locationId]);

  useEffect(() => {
    if (locationId === null || invalidating.current) return;
    const stale = items.filter((row) => isStaleMatch(row, locationId));
    if (stale.length === 0) return;

    invalidating.current = true;
    resetMatches(stale)
      .then((n) => setStaleCount((c) => c + n))
      .catch((err) => console.error('store switch invalidation failed', err))
      .finally(() => {
        invalidating.current = false;
      });
  }, [items, locationId]);

  useEffect(() => {
    if (locationId === null || resolving.current) return;
    const pending = items
      .filter((row) => needsResolve(row) && !attempted.current.has(row.id))
      .slice(0, RESOLVE_BATCH_LIMIT);
    if (pending.length === 0) return;

    resolving.current = true;
    for (const row of pending) attempted.current.add(row.id);
    setResolvingIds(new Set(pending.map((row) => row.id)));

    resolveItems(
      locationId,
      pending.map((row) => ({ id: row.id, name: row.name })),
      uid,
    )
      .then(async (matches) => {
        const entries = Object.entries(matches);
        await Promise.all(
          entries.map(([id, match]) =>
            setMatch(id, match).catch((err) => console.error('could not save match', id, err)),
          ),
        );
        setAnnouncement(summarize(entries.map(([, match]) => match)));
      })
      .catch((err) => {
        // Silent by design: the list is fully usable unmatched, and a toast per snapshot
        // while the store is unreachable would be worse than no store at all.
        console.error('resolveItems failed', err);
      })
      .finally(() => {
        resolving.current = false;
        setResolvingIds(new Set());
      });
  }, [items, locationId, uid]);

  return {
    resolvingIds,
    announcement,
    staleCount,
    dismissStale: () => setStaleCount(0),
    retry: (id) => attempted.current.delete(id),
  };
}
