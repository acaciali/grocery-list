/**
 * Manual recipe entry -- recipe.md's "Manual entry" MVP, minus editing an existing recipe.
 * Ingredient row = quantity + unit dropdown + name, exactly as the todo specifies.
 *
 * Writes the `Recipe` shape from packages/shared, so `ingredients` is typed `Item[]` and a
 * drifting field is a compile error rather than an integration bug.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  db,
  normalizeKey,
  UNITS,
  type Item,
  type Unit,
} from '@grocery/shared';
import { parseQuantity, parseWholeNumber } from './quantity';

/**
 * `Recipe.createdBy` is a required string, but the app has no auth: it is single-user and
 * every surface shares one project, so there is no uid to put here. This stands in until
 * accounts exist, at which point it becomes a real uid and old rows read as "whoever set
 * this up". Kept as a named constant so those rows are findable when that happens.
 */
const SINGLE_USER = 'single-user';

/** One editable ingredient row. `rowId` is a React key only -- it is never persisted. */
interface IngredientRow {
  rowId: number;
  amount: string;
  unit: '' | Unit;
  name: string;
}

const STARTER_ROWS = 3;

/**
 * Servings and the three durations behave identically -- optional positive whole numbers
 * -- so they're described once here and rendered in a loop. `field` is the Recipe field
 * name, which keeps the form and the contract spelled the same way.
 */
const COUNT_FIELDS = [
  { field: 'servings', label: 'Servings', placeholder: '4' },
  { field: 'totalMinutes', label: 'Total time (min)', placeholder: '45' },
  { field: 'prepMinutes', label: 'Prep time (min)', placeholder: '15' },
  { field: 'cookMinutes', label: 'Cook time (min)', placeholder: '30' },
] as const;

type CountField = (typeof COUNT_FIELDS)[number]['field'];

const BLANK_COUNTS: Record<CountField, string> = {
  servings: '',
  totalMinutes: '',
  prepMinutes: '',
  cookMinutes: '',
};

function blankRow(rowId: number): IngredientRow {
  return { rowId, amount: '', unit: '', name: '' };
}

function starterRows(firstId: number): IngredientRow[] {
  return Array.from({ length: STARTER_ROWS }, (_, i) => blankRow(firstId + i));
}

export default function RecipePage() {
  const nextRowId = useRef(STARTER_ROWS);
  const [title, setTitle] = useState('');
  const [counts, setCounts] = useState<Record<CountField, string>>(BLANK_COUNTS);
  const [rows, setRows] = useState<IngredientRow[]>(() => starterRows(0));
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(msg: string, kind: 'info' | 'error' = 'info') {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  function updateRow(rowId: number, patch: Partial<Omit<IngredientRow, 'rowId'>>) {
    setRows((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    const rowId = nextRowId.current;
    nextRowId.current += 1;
    setRows((current) => [...current, blankRow(rowId)]);
  }

  function removeRow(rowId: number) {
    setRows((current) => {
      // Keep one row on screen; emptying it is the same gesture with no layout jump.
      if (current.length === 1) return [blankRow(current[0]!.rowId)];
      return current.filter((row) => row.rowId !== rowId);
    });
  }

  function resetForm() {
    const firstId = nextRowId.current;
    nextRowId.current += STARTER_ROWS;
    setTitle('');
    setCounts(BLANK_COUNTS);
    setRows(starterRows(firstId));
    setInstructions('');
    setNotes('');
  }

  /**
   * Rows with a blank name are treated as unused, so the three starter rows never force
   * the cook to fill them all in. Everything else is validated rather than coerced.
   */
  function collectIngredients(): { ok: true; items: Item[] } | { ok: false; msg: string } {
    const used = rows.filter((row) => row.name.trim() !== '');
    if (used.length === 0) return { ok: false, msg: 'Add at least one ingredient' };

    const items: Item[] = [];
    for (const row of used) {
      const name = row.name.trim();

      const quantity = parseQuantity(row.amount);
      if (!quantity.ok) {
        return { ok: false, msg: `Amount for “${name}” is ${quantity.reason}` };
      }

      // normalizeKey throws when nothing identifying survives ("fresh", "a pinch of").
      let key: Item['key'];
      try {
        key = normalizeKey(name);
      } catch {
        return { ok: false, msg: `“${name}” needs a more specific ingredient name` };
      }

      items.push({
        key,
        name,
        // The form doesn't ask for a category yet, and Item requires one. 'other' is the
        // honest placeholder -- see the note in recipe.md about the category picker.
        category: 'other',
        quantity: quantity.value,
        unit: row.unit === '' ? null : row.unit,
      });
    }
    return { ok: true, items };
  }

  /**
   * Blank means "not stated", so it's omitted from the document rather than written as
   * null -- an absent field reads as unknown, where null reads as deliberately zero.
   */
  function collectCounts():
    | { ok: true; values: Partial<Record<CountField, number>> }
    | { ok: false; msg: string } {
    const values: Partial<Record<CountField, number>> = {};
    for (const { field, label } of COUNT_FIELDS) {
      const parsed = parseWholeNumber(counts[field]);
      if (!parsed.ok) return { ok: false, msg: `${label} is ${parsed.reason}` };
      if (parsed.value !== null) values[field] = parsed.value;
    }
    return { ok: true, values };
  }

  async function saveRecipe(e: FormEvent) {
    e.preventDefault();

    const cleanTitle = title.trim();
    if (cleanTitle === '') {
      showToast('Give the recipe a name', 'error');
      return;
    }

    const ingredients = collectIngredients();
    if (!ingredients.ok) {
      showToast(ingredients.msg, 'error');
      return;
    }

    const countFields = collectCounts();
    if (!countFields.ok) {
      showToast(countFields.msg, 'error');
      return;
    }

    const steps = instructions
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    setSaving(true);
    try {
      const cleanNotes = notes.trim();
      await addDoc(collection(db, 'recipes'), {
        title: cleanTitle,
        ...countFields.values,
        ingredients: ingredients.items,
        steps,
        tags: [],
        // Omitted rather than stored as '' so `notes` stays absent when unused.
        ...(cleanNotes === '' ? {} : { notes: cleanNotes }),
        createdBy: SINGLE_USER,
        createdAt: serverTimestamp(),
      });
      resetForm();
      showToast('Recipe saved');
    } catch (err) {
      console.error(err);
      showToast("Couldn't save", 'error');
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    'min-h-12 w-full rounded-card border border-line bg-surface px-3 text-base outline-none focus:border-accent';
  const labelClass = 'text-xs font-bold uppercase tracking-wide text-ink-soft';

  return (
    <section>
      <form onSubmit={saveRecipe} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="recipe-title" className={labelClass}>
            Recipe name
          </label>
          <input
            id="recipe-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sunday chili"
            className={fieldClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {COUNT_FIELDS.map(({ field, label, placeholder }) => (
            <div key={field} className="space-y-1.5">
              <label htmlFor={`recipe-${field}`} className={labelClass}>
                {label}
              </label>
              <input
                id={`recipe-${field}`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={counts[field]}
                onChange={(e) =>
                  setCounts((current) => ({ ...current, [field]: e.target.value }))
                }
                placeholder={placeholder}
                className={fieldClass}
              />
            </div>
          ))}
          <p className="col-span-2 -mt-1 text-xs text-ink-soft">
            All four are optional. Total time is stored as you enter it, not as prep + cook —
            resting and marinating live in the gap.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className={labelClass}>Ingredients</legend>

          <div
            aria-hidden="true"
            className="grid grid-cols-[4.5rem_6rem_1fr_2.25rem] gap-2 text-xs font-semibold text-ink-soft"
          >
            <span>Amount</span>
            <span>Unit</span>
            <span className="col-span-2">Ingredient</span>
          </div>

          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.rowId} className="grid grid-cols-[4.5rem_6rem_1fr_2.25rem] gap-2">
                <input
                  value={row.amount}
                  onChange={(e) => updateRow(row.rowId, { amount: e.target.value })}
                  placeholder="1 1/2"
                  aria-label={`Amount for ingredient ${index + 1}`}
                  className={fieldClass}
                />
                <select
                  value={row.unit}
                  onChange={(e) => updateRow(row.rowId, { unit: e.target.value as '' | Unit })}
                  aria-label={`Unit for ingredient ${index + 1}`}
                  className={fieldClass}
                >
                  <option value="">—</option>
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
                <input
                  value={row.name}
                  onChange={(e) => updateRow(row.rowId, { name: e.target.value })}
                  placeholder="black beans"
                  aria-label={`Ingredient ${index + 1} name`}
                  className={fieldClass}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.rowId)}
                  aria-label={`Remove ingredient ${index + 1}`}
                  className="min-h-12 rounded-card text-lg text-ink-soft hover:text-warn"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={addRow}
            className="min-h-12 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            + Add ingredient
          </button>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor="recipe-instructions" className={labelClass}>
            Instructions
          </label>
          <textarea
            id="recipe-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={8}
            placeholder="One step per line…"
            className={`${fieldClass} py-3 leading-relaxed`}
          />
          <p className="text-xs text-ink-soft">One step per line.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="recipe-notes" className={labelClass}>
            Notes
          </label>
          <textarea
            id="recipe-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Swaps, where it came from, what to serve with it…"
            className={`${fieldClass} py-3 leading-relaxed`}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-12 flex-1 rounded-card bg-accent px-5 font-semibold text-white active:opacity-80 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save recipe'}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="min-h-12 rounded-card border border-line bg-surface px-4 font-semibold text-ink-soft hover:text-ink"
          >
            Clear
          </button>
        </div>
      </form>

      {toast && (
        <p
          role="status"
          className={`fixed inset-x-4 bottom-4 mx-auto max-w-md rounded-card px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-warn' : 'bg-ink'
          }`}
        >
          {toast.msg}
        </p>
      )}
    </section>
  );
}
