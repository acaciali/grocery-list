/**
 * 🔗 I1 · Recipe → Grocery, the Recipe half: the confirm sheet behind "Add to groceries".
 *
 * One screen covers all three things a cook wants to do, because they are the same
 * decision at different starting points:
 *
 *   - add everything        → open, tap Add (or "All" first if the pantry pre-unchecked some)
 *   - skip what I own       → open, tap Add; pantry items are already unchecked
 *   - add all but these     → open, untick the few you have, tap Add
 *
 * Three separate buttons would write to the list without ever showing what was about to
 * happen. The pantry cross-check (I2) is the reason that matters: `normalizeKey` is still
 * PENDING SIGN-OFF per items.ts, so "you already have garlic" is a good guess, not a fact.
 * Showing the guess as a pre-ticked checkbox makes it correctable in one tap; acting on it
 * silently makes it a bug the cook only finds in the store.
 */
import { useEffect, useState } from 'react';
import { hasMany, type Item, type ItemKey } from '@grocery/shared';
import {
  addRecipeIngredients,
  readGroceryList,
  safeKey,
  type AddSummary,
} from '../grocery/addFromRecipe';
import { formatMeasure } from './quantity';

/** One ingredient as the sheet holds it. */
interface Line {
  /** Index-based: two lines can share a key ("2 cups milk", "1 cup milk"). */
  id: number;
  item: Item;
  /** I2: this key is already in the pantry, so it starts unticked. */
  inPantry: boolean;
  /** Already on the grocery list -- adding will bump that row, not make a second one. */
  onList: boolean;
  checked: boolean;
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; lines: Line[]; pantryChecked: boolean }
  | { status: 'error' };

/**
 * Build the sheet's lines from what the pantry and the list say.
 *
 * `pantryKeys` is null when the pantry could not be read. Everything then starts ticked:
 * failing to check is not evidence that you own nothing, and the banner says as much.
 */
function buildLines(
  ingredients: Item[],
  pantryKeys: Set<string> | null,
  listKeys: Set<string>,
): Line[] {
  return ingredients.map((item, index) => {
    const key = safeKey(item.name);
    const inPantry = pantryKeys !== null && key !== undefined && pantryKeys.has(key);
    return {
      id: index,
      item,
      inPantry,
      onList: key !== undefined && listKeys.has(key),
      checked: !inPantry,
    };
  });
}

export default function AddToGrocerySheet({
  recipeId,
  recipeTitle,
  ingredients,
  onClose,
  onDone,
}: {
  recipeId: string;
  recipeTitle: string;
  ingredients: Item[];
  onClose: () => void;
  onDone: (summary: AddSummary) => void;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const keys = ingredients
        .map((item) => safeKey(item.name))
        .filter((key): key is ItemKey => key !== undefined);

      // The list read is what the sheet labels rows with; the merge re-reads at write time
      // so a list edited in another tab meanwhile still merges correctly.
      const [pantry, list] = await Promise.allSettled([hasMany(keys), readGroceryList()]);
      if (cancelled) return;

      if (list.status === 'rejected') {
        console.error(list.reason);
        setLoad({ status: 'error' });
        return;
      }

      // A failed pantry read degrades to "couldn't check" rather than taking down the
      // whole sheet -- adding ingredients is still worth doing without I2.
      let pantryKeys: Set<string> | null = null;
      if (pantry.status === 'fulfilled') {
        pantryKeys = new Set(
          Object.entries(pantry.value)
            .filter(([, owned]) => owned)
            .map(([key]) => key),
        );
      } else {
        console.error(pantry.reason);
      }

      const listKeys = new Set(
        list.value
          .filter((row) => !row.checked)
          .map((row) => row.key ?? safeKey(row.name))
          .filter((key): key is ItemKey => key !== undefined),
      );

      setLoad({
        status: 'ready',
        lines: buildLines(ingredients, pantryKeys, listKeys),
        pantryChecked: pantryKeys !== null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [ingredients]);

  function setAll(checked: boolean) {
    setLoad((current) =>
      current.status === 'ready'
        ? { ...current, lines: current.lines.map((line) => ({ ...line, checked })) }
        : current,
    );
  }

  function toggle(id: number, checked: boolean) {
    setLoad((current) =>
      current.status === 'ready'
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.id === id ? { ...line, checked } : line,
            ),
          }
        : current,
    );
  }

  async function save() {
    if (load.status !== 'ready') return;
    const picked = load.lines.filter((line) => line.checked).map((line) => line.item);
    if (picked.length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      onDone(await addRecipeIngredients(recipeId, picked));
    } catch (err) {
      console.error(err);
      setSaveError("Couldn't add those to your list.");
    } finally {
      setSaving(false);
    }
  }

  const lines = load.status === 'ready' ? load.lines : [];
  const missing = lines.filter((line) => !line.inPantry);
  const owned = lines.filter((line) => line.inPantry);
  const selected = lines.filter((line) => line.checked).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Tapping the scrim is the same "never mind" as Cancel. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-grocery-title"
        className="relative flex max-h-[85dvh] flex-col rounded-t-[20px] bg-bg shadow-lg"
      >
        <header className="border-b border-line px-4 py-3">
          <h2 id="add-to-grocery-title" className="font-bold">
            Add to grocery list
          </h2>
          <p className="text-sm text-ink-soft">
            {recipeTitle} · {ingredients.length} ingredient
            {ingredients.length === 1 ? '' : 's'}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {load.status === 'loading' && (
            <p className="py-6 text-center text-sm text-ink-soft">Checking your pantry…</p>
          )}

          {load.status === 'error' && (
            <p role="alert" className="rounded-card border border-warn px-4 py-3 text-sm text-warn">
              Couldn’t read your grocery list, so there’s nothing safe to add to. Try again.
            </p>
          )}

          {load.status === 'ready' && (
            <>
              {!load.pantryChecked && (
                // Say it plainly. A sheet that silently skipped the pantry check but still
                // looks like it ran one is how someone re-buys a jar of cumin.
                <p className="mb-3 rounded-card border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                  Couldn’t check your pantry, so nothing is pre-skipped — everything is
                  ticked.
                </p>
              )}

              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-ink-soft">
                  {selected} of {lines.length} selected
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAll(true)}
                    className="min-h-9 rounded-card border border-line bg-surface px-3 text-sm font-semibold text-ink-soft hover:text-ink"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setAll(false)}
                    className="min-h-9 rounded-card border border-line bg-surface px-3 text-sm font-semibold text-ink-soft hover:text-ink"
                  >
                    None
                  </button>
                </div>
              </div>

              <ul className="space-y-2">
                {missing.map((line) => (
                  <IngredientRow key={line.id} line={line} onToggle={toggle} />
                ))}
              </ul>

              {owned.length > 0 && (
                <>
                  <p className="mt-5 px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    Already in your pantry
                  </p>
                  <ul className="mt-1 space-y-2">
                    {owned.map((line) => (
                      <IngredientRow key={line.id} line={line} onToggle={toggle} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        {/* Pinned, so the primary action stays reachable on a phone with twenty ingredients. */}
        <div className="border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {saveError && (
            <p role="alert" className="mb-2 text-sm font-semibold text-warn">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={selected === 0 || saving || load.status !== 'ready'}
            className="min-h-12 w-full rounded-card bg-accent font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'Adding…' : `Add ${selected} item${selected === 1 ? '' : 's'} to list`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 min-h-11 w-full rounded-card border border-line font-semibold text-ink-soft"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IngredientRow({
  line,
  onToggle,
}: {
  line: Line;
  onToggle: (id: number, checked: boolean) => void;
}) {
  const measure = formatMeasure(line.item);

  return (
    <li
      className={`rounded-card border bg-surface shadow-sm transition-colors ${
        line.checked ? 'border-accent' : 'border-line'
      } ${line.inPantry ? 'opacity-70' : ''}`}
    >
      <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
        <input
          type="checkbox"
          checked={line.checked}
          onChange={(e) => onToggle(line.id, e.target.checked)}
          className="size-5 shrink-0 accent-[var(--color-accent)]"
        />
        {measure && (
          <span className="w-20 shrink-0 text-sm font-semibold tabular-nums">{measure}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{line.item.name}</span>
          {(line.inPantry || line.onList) && (
            <span className="block text-xs text-ink-soft">
              {line.inPantry && <span className="font-semibold text-accent">Already have this.</span>}
              {line.inPantry && line.onList && ' '}
              {line.onList && <span>On your list — this adds to it.</span>}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
