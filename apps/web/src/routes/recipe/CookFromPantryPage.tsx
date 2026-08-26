/**
 * 🥫➜🍳 Cook from my pantry -- the cookbook ranked by what you actually have.
 *
 * This is the INVENTORY ──► RECIPE arrow from CLAUDE.md, the last one in the loop. It is
 * live on both ends: add milk on the Pantry tab and this list re-ranks under you, because
 * `useRecipeMatches` holds two subscriptions rather than doing a one-shot read.
 *
 * The screen is deliberately presentational. Scoring belongs to shared/matching.ts, the
 * copy and the write plan belong to cookFromPantry.ts, and the grocery write itself belongs
 * to Grocery's addRecipeIngredients(). Nothing here re-decides any of it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COMMON_STAPLES, type MatchSort, type RecipeMatch, type RecipeRow } from '@grocery/shared';
import { addRecipeIngredients, type AddSummary } from '../grocery/addFromRecipe';
import { ToastBar, useToast } from '../inventory/useToast';
import {
  assumedIngredients,
  countMissing,
  haveLabel,
  namesList,
  planMissingByRecipe,
  summarizeAdds,
} from './cookFromPantry';
import { useRecipeMatches } from './useRecipeMatches';

type Match = RecipeMatch<RecipeRow>;

/**
 * The three honest readings of "matches best", in shared's own words. Labelled as questions
 * a cook asks rather than as the metric behind them -- "Fewest to buy" is the decision,
 * `missingCount ascending` is the implementation.
 */
const SORTS: readonly { id: MatchSort; label: string }[] = [
  { id: 'missing', label: 'Fewest to buy' },
  { id: 'coverage', label: 'Best fit' },
  { id: 'matches', label: 'Most matched' },
];

/**
 * `maxMissing` as a chip. `Infinity` for All rather than `undefined` so the filter is one
 * comparison everywhere instead of a special case.
 */
const FILTERS = [
  { id: 'now', label: 'Cook now', maxMissing: 0 },
  { id: 'one-stop', label: 'One stop', maxMissing: 2 },
  { id: 'all', label: 'All', maxMissing: Number.POSITIVE_INFINITY },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

export default function CookFromPantryPage() {
  const [sort, setSort] = useState<MatchSort>('missing');
  const [filter, setFilter] = useState<FilterId>('one-stop');
  /**
   * On by default. Without it every recipe calling for salt and pepper reads as "2 missing"
   * and the ranking turns to noise -- the same two items penalising everything equally.
   */
  const [staples, setStaples] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const { matches, recipeCount, pantryCount, loading, error } = useRecipeMatches({
    sort,
    // A module constant either way, so the memo inside the hook is not churned by this.
    assumedKeys: staples ? COMMON_STAPLES : undefined,
    // recipe.md: recipes sharing nothing at all with the pantry are not "matches", they
    // are the rest of the cookbook. /recipe is where you browse those.
    minMatches: 1,
  });

  /**
   * Chip counts come off the full ranked list, not the filtered one -- that is what lets
   * "Cook now 0" tell you there is nothing rather than looking like an empty screen.
   */
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, matches.filter((m) => m.missingCount <= f.maxMissing).length]),
      ) as Record<FilterId, number>,
    [matches],
  );

  const maxMissing = FILTERS.find((f) => f.id === filter)!.maxMissing;
  const visible = useMemo(
    () => matches.filter((m) => m.missingCount <= maxMissing),
    [matches, maxMissing],
  );

  /**
   * Derived from what is on screen rather than held as its own list. A recipe that drops out
   * of the filter -- or out of the ranking entirely, because you just bought its last
   * missing item -- stops being selected without any pruning effect to get wrong.
   */
  const selectedMatches = useMemo(
    () => visible.filter((m) => selected.has(m.recipe.id)),
    [visible, selected],
  );
  const groups = useMemo(() => planMissingByRecipe(selectedMatches), [selectedMatches]);
  const missingCount = countMissing(groups);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /**
   * 🔗 I1. One call to Grocery per selected recipe, each with that recipe's own share of the
   * shopping list, so every row lands with a `sourceId` that traces back to a real recipe.
   *
   * Sequential rather than Promise.all: `planAdds` re-reads the list to decide add-vs-merge,
   * and a concurrent second call would plan against the rows the first one had not written
   * yet. A selection is a handful of recipes, so the round trips cost nothing that matters.
   *
   * No confirm sheet here, unlike the detail page: that sheet exists to show the pantry
   * cross-check before you commit to it, and on this screen the cross-check is the screen.
   * These items are, by definition, the ones the pantry does not have.
   */
  async function addMissing() {
    if (groups.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const summaries: AddSummary[] = [];
      for (const group of groups) {
        summaries.push(await addRecipeIngredients(group.recipeId, group.items));
      }
      setSelected(new Set());
      showToast(summarizeAdds(summaries));
    } catch (err) {
      console.error(err);
      setSaveError("Couldn't add those to your list.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Frame><p className="text-sm text-ink-soft">Reading your pantry…</p></Frame>;
  }

  if (error) {
    return (
      <Frame>
        {/* Blocking, not a banner over a list. An unreadable pantry ranks every recipe as
            "you have none of this", which is a confident wrong answer. */}
        <p role="alert" className="rounded-card border border-warn/30 bg-warn/10 p-6 text-center text-sm text-warn">
          {error}
        </p>
      </Frame>
    );
  }

  if (recipeCount === 0) {
    return (
      <Frame>
        <EmptyState
          emoji="🍳"
          title="No recipes yet"
          body="There's nothing to match your pantry against. Add a recipe and it shows up here."
          action={{ to: '/recipe/new', label: '+ New recipe' }}
        />
      </Frame>
    );
  }

  if (pantryCount === 0) {
    return (
      <Frame>
        {/* Deliberately not a list of every recipe scored 0 -- that is a wall of "you have
            none of this", which is true and useless. */}
        <EmptyState
          emoji="🥫"
          title="Your pantry is empty"
          body="Add a few things to your pantry and we'll find you something to cook."
          action={{ to: '/inventory/add', label: '+ Add to pantry' }}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="space-y-2">
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`min-h-9 flex-1 rounded-full border px-2 text-sm font-semibold transition-colors ${
                filter === f.id
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-surface text-ink-soft'
              }`}
            >
              {f.label} {counts[f.id]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="match-sort" className="text-sm text-ink-soft">
            Sort
          </label>
          <select
            id="match-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as MatchSort)}
            className="min-h-9 flex-1 rounded-card border border-line bg-surface px-2 text-sm font-semibold outline-none focus:border-accent"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={staples}
            onChange={(e) => setStaples(e.target.checked)}
            className="size-4 shrink-0 accent-[var(--color-accent)]"
          />
          Assume I have salt, pepper and water
        </label>
      </div>

      {matches.length === 0 && (
        <EmptyState
          emoji="🤷"
          title="Nothing overlaps yet"
          body="None of your recipes use anything that's in your pantry right now. Add a few more staples and check back."
          action={{ to: '/inventory/add', label: '+ Add to pantry' }}
        />
      )}

      {matches.length > 0 && visible.length === 0 && (
        // Offer to widen rather than showing nothing: there ARE matches, just not this close.
        <div className="rounded-card border border-line bg-surface p-6 text-center shadow-sm">
          <p className="text-sm text-ink-soft">
            Nothing you can cook with {maxMissing === 0 ? 'nothing' : `${maxMissing} or fewer ingredients`} to
            buy.
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mt-3 min-h-11 rounded-card border border-accent px-4 text-sm font-semibold text-accent"
          >
            Show all {counts.all} match{counts.all === 1 ? '' : 'es'}
          </button>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="space-y-3 pb-20">
          {visible.map((match) => (
            <MatchCard
              key={match.recipe.id}
              match={match}
              selected={selected.has(match.recipe.id)}
              onToggle={() => toggle(match.recipe.id)}
            />
          ))}
        </ul>
      )}

      {selectedMatches.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-xl">
            {saveError && (
              <p role="alert" className="mb-2 text-sm font-semibold text-warn">
                {saveError}
              </p>
            )}
            <button
              type="button"
              onClick={addMissing}
              disabled={saving || missingCount === 0}
              className="min-h-12 w-full rounded-card bg-accent font-semibold text-white disabled:opacity-40"
            >
              {saving
                ? 'Adding…'
                : missingCount === 0
                  ? `You have everything for ${selectedMatches.length} recipe${selectedMatches.length === 1 ? '' : 's'}`
                  : `🛒 Add ${missingCount} missing item${missingCount === 1 ? '' : 's'} from ${selectedMatches.length} recipe${selectedMatches.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      <ToastBar toast={toast} />
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Cook from my pantry</h2>
        <Link to="/recipe" className="text-sm font-semibold text-ink-soft hover:text-ink">
          Cookbook →
        </Link>
      </div>
      {children}
    </section>
  );
}

function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string;
  title: string;
  body: string;
  action: { to: string; label: string };
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
      <p className="text-4xl" aria-hidden="true">
        {emoji}
      </p>
      <h3 className="mt-3 text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
      <Link
        to={action.to}
        className="mt-4 inline-flex min-h-11 items-center rounded-card bg-accent px-4 text-sm font-semibold text-white active:opacity-80"
      >
        {action.label}
      </Link>
    </div>
  );
}

function MatchCard({
  match,
  selected,
  onToggle,
}: {
  match: Match;
  selected: boolean;
  onToggle: () => void;
}) {
  const { recipe } = match;
  const assumed = assumedIngredients(match);
  const cookable = match.missingCount === 0;

  return (
    <li
      className={`overflow-hidden rounded-card border bg-surface shadow-sm transition-colors ${
        selected ? 'border-accent' : 'border-line'
      }`}
    >
      <div className="flex gap-3 p-3">
        {/* Its own control rather than a label wrapping the card, so the title stays a link. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${recipe.title}`}
          className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
        />

        {recipe.imageUrl && (
          // Hotlinked from the source site, so it can 404 at any time (CLAUDE.md). Drop the
          // element rather than leaving a broken-image glyph in the layout.
          <img
            src={recipe.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className="size-16 shrink-0 rounded-card object-cover"
          />
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={`/recipe/${recipe.id}`}
              className="line-clamp-2 font-semibold leading-snug hover:text-accent"
            >
              {recipe.title}
            </Link>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                cookable ? 'bg-positive text-ink' : 'bg-almond-silk text-ink'
              }`}
            >
              {match.haveCount}/{match.totalCount}
            </span>
          </div>

          <p className="text-sm text-ink-soft">
            {haveLabel(match)}
            {cookable ? ' — you can cook this now.' : ` — you need: ${namesList(match.missing)}`}
          </p>

          {assumed.length > 0 && (
            // ⚠️ Never folded into the badge above. Counting salt as present is a useful
            // default; telling a cook their pantry holds something nobody logged is a claim
            // this screen cannot back up. Same rule as the shelf-photo review grid.
            <p className="text-xs text-ink-soft">
              <span className="underline decoration-dotted underline-offset-2" title="Assumed, not in your pantry">
                assuming
              </span>{' '}
              {namesList(assumed, 4)}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
