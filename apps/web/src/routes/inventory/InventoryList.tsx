/**
 * The grouped pantry list: location first, then category inside it. That order matches how
 * people actually restock -- you stand in front of one door at a time.
 */
import { useState } from 'react';
import type { Category, InventoryRow, StorageLocation } from '@grocery/shared';
import { pantry } from './pantryStore';
import {
  ADDED_VIA_META,
  CATEGORIES,
  CATEGORY_LABEL,
  LOCATIONS,
  LOCATION_META,
  HIGH_CONFIDENCE,
} from './constants';

const field =
  'min-h-11 rounded-card border border-line bg-surface px-3 text-base outline-none focus:border-accent';

export default function InventoryList({
  uid,
  rows,
  onError,
  onDone,
}: {
  uid: string;
  rows: InventoryRow[];
  onError: (msg: string) => void;
  onDone: (msg: string) => void;
}) {
  return (
    <div className="space-y-5">
      {LOCATIONS.map((location) => {
        const inLocation = rows.filter((r) => r.location === location);
        if (inLocation.length === 0) return null;

        // Only render categories that actually have something in them, in contract order.
        const categories = CATEGORIES.filter((c) => inLocation.some((r) => r.category === c));

        return (
          <section key={location}>
            <h3 className="flex items-baseline gap-2 px-1 text-sm font-bold">
              <span aria-hidden="true">{LOCATION_META[location].emoji}</span>
              {LOCATION_META[location].label}
              <span className="text-xs font-normal text-ink-soft">{inLocation.length}</span>
            </h3>

            {categories.map((category) => (
              <div key={category} className="mt-2">
                <p className="px-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
                  {CATEGORY_LABEL[category]}
                </p>
                <ul className="mt-1 space-y-1.5">
                  {inLocation
                    .filter((r) => r.category === category)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((row) => (
                      <Row
                        key={row.id}
                        uid={uid}
                        row={row}
                        onError={onError}
                        onDone={onDone}
                      />
                    ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Row({
  uid,
  row,
  onError,
  onDone,
}: {
  uid: string;
  row: InventoryRow;
  onError: (msg: string) => void;
  onDone: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <EditRow
        uid={uid}
        row={row}
        onError={onError}
        onDone={(msg) => {
          setEditing(false);
          onDone(msg);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const via = ADDED_VIA_META[row.addedVia];
  // A photo guess we accepted below the pre-check bar is worth flagging for as long as it
  // lives, not just in the review grid -- it's the row most likely to be wrong.
  const lowConfidence =
    row.addedVia === 'photo' && typeof row.confidence === 'number' && row.confidence < HIGH_CONFIDENCE;

  return (
    <li className="flex items-center rounded-card border border-line bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex min-h-12 flex-1 flex-col justify-center px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {row.quantity != null && (
            <span className="text-sm text-ink-soft">
              {row.quantity}
              {row.unit ? ` ${row.unit}` : ''}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
          <span title={via.label} aria-hidden="true">
            {via.emoji}
          </span>
          <span className="sr-only">{via.label}</span>
          {lowConfidence && (
            <span className="rounded-full bg-warn/10 px-1.5 text-warn">
              low confidence · double-check
            </span>
          )}
        </span>
      </button>

      {confirmingDelete ? (
        <span className="flex items-center gap-1 pr-2">
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  await pantry.deleteItem(uid, row.key);
                  onDone(`Removed ${row.name}`);
                } catch (err) {
                  console.error(err);
                  onError("Couldn't remove that.");
                }
              })();
            }}
            className="min-h-9 rounded-card bg-warn px-3 text-sm font-semibold text-white"
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="min-h-9 px-2 text-sm text-ink-soft"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label={`Remove ${row.name}`}
          className="min-h-12 px-4 text-lg text-ink-soft hover:text-warn"
        >
          ×
        </button>
      )}
    </li>
  );
}

function EditRow({
  uid,
  row,
  onError,
  onDone,
  onCancel,
}: {
  uid: string;
  row: InventoryRow;
  onError: (msg: string) => void;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState<Category>(row.category);
  const [location, setLocation] = useState<StorageLocation>(row.location);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      // renameItem handles both cases: an unchanged name is a plain upsert, a changed one
      // is a move to a new document id, because the id is derived from the key.
      await pantry.renameItem(uid, row.key, {
        name: trimmed,
        category,
        location,
        // An edited row has been vouched for by a human, so it stops being a photo guess.
        addedVia: row.addedVia === 'photo' ? 'manual' : row.addedVia,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
        upc: row.upc ?? null,
      });
      onDone(`Saved ${trimmed}`);
    } catch (err) {
      console.error(err);
      onError("Couldn't save that change.");
      setBusy(false);
    }
  }

  return (
    <li className="rounded-card border border-accent bg-surface p-3 shadow-sm">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Item name"
        autoFocus
        className={`${field} w-full`}
      />
      <div className="mt-2 flex gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          aria-label="Category"
          className={`${field} flex-1`}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value as StorageLocation)}
          aria-label="Location"
          className={`${field} flex-1`}
        >
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>
              {LOCATION_META[l].emoji} {LOCATION_META[l].label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || name.trim() === ''}
          className="min-h-11 flex-1 rounded-card bg-accent font-semibold text-white disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-card border border-line px-4 font-semibold text-ink-soft"
        >
          Cancel
        </button>
      </div>
    </li>
  );
}
