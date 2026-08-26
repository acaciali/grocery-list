/**
 * 🥫 Inventory. Presence-based: we track WHETHER you have something, not how much.
 *
 * This page is the list and nothing else -- search, filters, rows. Everything that adds
 * food lives on /inventory/add (AddItemPage), reached by the button in the corner, so the
 * list isn't permanently pushed down by a form.
 *
 * Reads and writes go through the shared data layer (packages/shared/src/inventory.ts),
 * which is also where Grocery gets has() for I2 and Recipe gets getAllKeys() for I5.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { InventoryRow, StorageLocation } from '@grocery/shared';
import InventoryList from './InventoryList';
import { LOCATIONS, LOCATION_META } from './constants';
import { pantry } from './pantryStore';
import { useInventory } from './useInventory';
import { ToastBar, useToast } from './useToast';

type LocationFilter = StorageLocation | 'all';

export default function InventoryPage() {
  const { rows, uid, loading, error } = useInventory();
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');
  const { toast, showToast } = useToast();

  // A save on the add page navigates here with its message in tow. Replace the entry
  // afterwards so a refresh or a Back doesn't replay "Added Milk".
  const location = useLocation();
  const navigate = useNavigate();
  const handoff = (location.state as { toast?: string } | null)?.toast;
  useEffect(() => {
    if (!handoff) return;
    showToast(handoff);
    navigate('/inventory', { replace: true, state: null });
    // showToast/navigate are stable enough here; the message is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row: InventoryRow) => {
      if (locationFilter !== 'all' && row.location !== locationFilter) return false;
      if (!needle) return true;
      // Match the key too, so searching "chicken" finds "Chicken breast" even when the
      // display name was capitalized or pluralized differently.
      return row.name.toLowerCase().includes(needle) || row.key.includes(needle);
    });
  }, [rows, search, locationFilter]);

  const addButton = (
    <Link
      to="/inventory/add"
      className="inline-flex min-h-11 items-center rounded-card bg-accent px-4 text-sm font-semibold text-white active:opacity-80"
    >
      + Add new item
    </Link>
  );

  if (loading) {
    return (
      <p className="rounded-card border border-line bg-surface p-8 text-center text-sm text-ink-soft">
        Loading your pantry…
      </p>
    );
  }

  if (error) {
    return (
      <p className="rounded-card border border-warn/30 bg-warn/10 p-6 text-center text-sm text-warn">
        {error}
      </p>
    );
  }

  // uid is non-null whenever loading is false and there is no error, but the compiler
  // can't know that, and a cast would be a lie waiting to bite.
  if (!uid) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">
          Your pantry{' '}
          {rows.length > 0 && <span className="font-normal text-ink-soft">({rows.length})</span>}
        </h2>
        {addButton}
      </div>

      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
            placeholder="Search your pantry…"
            aria-label="Search pantry"
            className="min-h-11 w-full rounded-card border border-line bg-surface px-4 text-base outline-none focus:border-accent"
          />
          <div className="flex gap-1.5">
            {(['all', ...LOCATIONS] as LocationFilter[]).map((filter) => {
              const active = locationFilter === filter;
              const count =
                filter === 'all' ? rows.length : rows.filter((r) => r.location === filter).length;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setLocationFilter(filter)}
                  className={`min-h-9 flex-1 rounded-full border px-2 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-surface text-ink-soft'
                  }`}
                >
                  {filter === 'all' ? 'All' : LOCATION_META[filter].label} {count}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4">
        {rows.length === 0 ? (
          // Empty state points at the add page, which is now the only way in.
          <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
            <p className="text-4xl" aria-hidden="true">
              🥫
            </p>
            <h2 className="mt-3 font-bold">Your pantry is empty</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Add an item, tap a staple, or photograph a shelf and confirm what's on it. Once
              there's food in here, your grocery list stops suggesting things you already own.
            </p>
            <div className="mt-4 flex flex-col items-center gap-2">
              {addButton}
              {pantry.isLocal && (
                <button
                  type="button"
                  onClick={() => void pantry.loadSample(uid)}
                  className="min-h-11 rounded-card border border-line px-4 text-sm font-semibold text-ink-soft hover:text-accent"
                >
                  Load sample pantry
                </button>
              )}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-soft">
            Nothing matches that.
          </p>
        ) : (
          <InventoryList
            uid={uid}
            rows={visible}
            onDone={showToast}
            onError={(m) => showToast(m, 'error')}
          />
        )}
      </div>

      {/* Say what this is out loud. A pantry that looks synced but only lives in one
          browser is the kind of thing that gets discovered during a demo. */}
      {pantry.isLocal && (
        <p className="mt-6 flex flex-wrap items-center justify-center gap-2 text-center text-xs text-ink-soft">
          <span>Stub data — saved in this browser only, no backend yet.</span>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => void pantry.clearAll(uid)}
              className="underline hover:text-warn"
            >
              Clear
            </button>
          )}
        </p>
      )}

      <ToastBar toast={toast} />
    </section>
  );
}
