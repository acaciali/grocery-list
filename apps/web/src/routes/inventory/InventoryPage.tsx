/**
 * 🥫 Inventory. Presence-based: we track WHETHER you have something, not how much.
 *
 * Manual logging is the MVP and the photo flow is the bonus, so the add form sits at the
 * top where it's reachable and the scan button sits beside it rather than above it.
 *
 * Reads and writes go through the shared data layer (packages/shared/src/inventory.ts),
 * which is also where Grocery gets has() for I2 and Recipe gets getAllKeys() for I5.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryRow, StorageLocation } from '@grocery/shared';
import AddItemForm from './AddItemForm';
import InventoryList from './InventoryList';
import ShelfCapture from './ShelfCapture';
import { LOCATIONS, LOCATION_META } from './constants';
import { pantry } from './pantryStore';
import { useInventory } from './useInventory';

type LocationFilter = StorageLocation | 'all';

export default function InventoryPage() {
  const { rows, uid, loading, error } = useInventory();
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(msg: string, kind: 'info' | 'error' = 'info') {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

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
      <AddItemForm
        uid={uid}
        rows={rows}
        onAdded={showToast}
        onError={(m) => showToast(m, 'error')}
      />

      <button
        type="button"
        onClick={() => setScanning(true)}
        className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-accent/40 bg-accent/5 font-semibold text-accent"
      >
        📸 Scan a shelf
      </button>

      {rows.length > 0 && (
        <div className="mt-4 space-y-2">
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
          // Empty state points at both ways in, because "scan a shelf" is the fast path
          // for a real pantry and typing is the fast path for one item.
          <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
            <p className="text-4xl" aria-hidden="true">
              🥫
            </p>
            <h2 className="mt-3 font-bold">Your pantry is empty</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Type something in above, tap a staple, or photograph a shelf and confirm what's
              on it. Once there's food in here, your grocery list stops suggesting things you
              already own.
            </p>
            {pantry.isLocal && (
              <button
                type="button"
                onClick={() => void pantry.loadSample(uid)}
                className="mt-4 min-h-11 rounded-card border border-line px-4 text-sm font-semibold text-ink-soft hover:text-accent"
              >
                Load sample pantry
              </button>
            )}
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

      {scanning && (
        <ShelfCapture
          uid={uid}
          rows={rows}
          onClose={() => setScanning(false)}
          onDone={showToast}
          onError={(m) => showToast(m, 'error')}
        />
      )}

      {toast && (
        <p
          role="status"
          className={`fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-md rounded-card px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-warn' : 'bg-ink'
          }`}
        >
          {toast.msg}
        </p>
      )}
    </section>
  );
}
