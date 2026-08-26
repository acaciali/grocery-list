/**
 * Manual logging. This is the MVP, so the whole design goal is speed: type a name, hit
 * enter, keep going. Category and location have sane defaults and quantity is genuinely
 * optional, because inventory is presence-based.
 *
 * Lives on its own page (routes/inventory/AddItemPage), so this renders as a full form
 * with a Save button rather than a one-line bar. `onSaved` is what sends you back to the
 * list; staples deliberately don't fire it, so you can tap several in a row.
 */
import { type FormEvent, useMemo, useState } from 'react';
import {
  normalizeKey,
  type Category,
  type InventoryRow,
  type StorageLocation,
  type Unit,
} from '@grocery/shared';
import { pantry } from './pantryStore';
import { CATEGORIES, CATEGORY_LABEL, LOCATIONS, LOCATION_META, STAPLES, UNITS } from './constants';
import { fromDateInputValue } from './dates';

const field =
  'min-h-12 rounded-card border border-line bg-surface px-3 text-base outline-none focus:border-accent';

export default function AddItemForm({
  uid,
  rows,
  onError,
  onAdded,
  onSaved,
}: {
  uid: string;
  rows: InventoryRow[];
  onError: (msg: string) => void;
  onAdded: (msg: string) => void;
  /** Called after a typed item saves -- the page uses it to return to the pantry list. */
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('pantry');
  const [location, setLocation] = useState<StorageLocation>('pantry');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<Unit | ''>('');
  const [expires, setExpires] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Autocomplete source: names already used, so a second entry matches the first. */
  const suggestions = useMemo(
    () => [...new Set(rows.map((r) => r.name))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  /**
   * normalizeKey throws on input with no identifying words left ("1 cup of"). Catching
   * here lets us disable the button instead of exploding on submit.
   */
  const pendingKey = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      return normalizeKey(trimmed);
    } catch {
      return null;
    }
  }, [name]);

  /**
   * Upsert-by-key means adding something you already have updates that row. Saying so
   * before the tap is the difference between "it worked" and "did it not add?".
   */
  const existing = pendingKey ? rows.find((r) => r.key === pendingKey) : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !pendingKey || busy) return;

    setBusy(true);
    // Clear optimistically -- the list is live, so the row appears on its own.
    setName('');
    setQuantity('');
    setUnit('');
    setExpires('');

    const parsedQuantity = Number.parseFloat(quantity);
    try {
      await pantry.upsertItem(uid, {
        name: trimmed,
        category,
        location,
        addedVia: 'manual',
        quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : null,
        unit: unit === '' ? null : unit,
        expiresAt: fromDateInputValue(expires),
      });
      onAdded(existing ? `Updated ${trimmed}` : `Added ${trimmed}`);
      onSaved();
    } catch (err) {
      console.error(err);
      setName(trimmed); // Hand the text back so the typing isn't lost.
      onError("Couldn't save that item.");
    } finally {
      setBusy(false);
    }
  }

  async function addStaple(staple: (typeof STAPLES)[number]) {
    try {
      await pantry.upsertItem(uid, { ...staple, addedVia: 'manual' });
      onAdded(`Added ${staple.name}`);
    } catch (err) {
      console.error(err);
      onError(`Couldn't add ${staple.name}.`);
    }
  }

  const stapleKeys = new Set(rows.map((r) => r.key));

  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-surface p-3 shadow-sm">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What are you adding?"
        aria-label="Item name"
        list="inventory-name-suggestions"
        autoComplete="off"
        autoFocus
        className={`${field} w-full`}
      />
      <datalist id="inventory-name-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {existing && (
        <p className="mt-2 text-xs text-ink-soft">
          You already have <strong>{existing.name}</strong> in the{' '}
          {LOCATION_META[existing.location].label.toLowerCase()} — this updates it.
        </p>
      )}

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

      {/* Collapsed by default: presence is what matters, so quantity should never slow
          down the common case of "I have this now". */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="mt-2 text-xs font-semibold text-ink-soft hover:text-accent"
      >
        {showDetails ? '− Hide extras' : '+ Add a quantity or expiry date (optional)'}
      </button>

      {showDetails && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="Qty"
              aria-label="Quantity"
              className={`${field} w-24`}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit | '')}
              aria-label="Unit"
              className={`${field} flex-1`}
            >
              <option value="">No unit</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="shrink-0">Expires</span>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              aria-label="Expiration date"
              className={`${field} flex-1`}
            />
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={!pendingKey || busy}
        className="mt-3 min-h-12 w-full rounded-card bg-accent font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {existing ? 'Save changes' : 'Save to pantry'}
      </button>

      {/* Staples save on tap and stay put, so three taps add three things. */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-ink-soft">One-tap staples</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STAPLES.map((staple) => {
            const have = stapleKeys.has(normalizeKey(staple.name));
            return (
              <button
                key={staple.name}
                type="button"
                onClick={() => void addStaple(staple)}
                // Already-have staples stay tappable: re-adding is a harmless upsert that
                // refreshes updatedAt, which is what "I restocked this" means.
                className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${
                  have
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line text-ink-soft hover:border-accent hover:text-accent'
                }`}
              >
                {have ? '✓ ' : '+ '}
                {staple.name}
              </button>
            );
          })}
        </div>
      </div>
    </form>
  );
}
