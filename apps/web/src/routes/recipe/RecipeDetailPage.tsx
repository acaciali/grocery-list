/**
 * One recipe, read-only: what you cook from. Ingredients, steps, notes and the timings.
 *
 * Read once rather than subscribed -- a recipe does not change under you mid-cook, and a
 * live listener here would only add a re-render for nothing.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, type Item, type Recipe } from '@grocery/shared';
import { formatQuantity } from './quantity';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; recipe: Recipe }
  | { status: 'missing' }
  | { status: 'error' };

/** "1 1/2 cup" — the measurement half of an ingredient line, blank when unmeasured. */
function measure(item: Item): string {
  const amount = item.quantity == null ? '' : formatQuantity(item.quantity);
  const unit = item.unit ?? '';
  return [amount, unit].filter(Boolean).join(' ');
}

/** The timings that were actually filled in. All four fields are optional. */
function timings(recipe: Recipe): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (recipe.servings) out.push({ label: 'Serves', value: String(recipe.servings) });
  if (recipe.totalMinutes) out.push({ label: 'Total', value: `${recipe.totalMinutes} min` });
  if (recipe.prepMinutes) out.push({ label: 'Prep', value: `${recipe.prepMinutes} min` });
  if (recipe.cookMinutes) out.push({ label: 'Cook', value: `${recipe.cookMinutes} min` });
  return out;
}

function RecipeBody({ recipe }: { recipe: Recipe }) {
  const facts = timings(recipe);
  const ingredients = recipe.ingredients ?? [];
  const steps = recipe.steps ?? [];
  const tags = recipe.tags ?? [];

  return (
    <article className="space-y-6">
      <header className="space-y-3">
        <h2 className="text-2xl font-bold leading-tight tracking-tight">{recipe.title}</h2>

        {facts.length > 0 && (
          <dl className="flex flex-wrap gap-2">
            {facts.map(({ label, value }) => (
              <div
                key={label}
                className="rounded-card border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <dt className="inline text-ink-soft">{label} </dt>
                <dd className="inline font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag} className="rounded-card bg-almond-silk px-2.5 py-1 text-xs font-semibold">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Ingredients</h3>
        {ingredients.length === 0 ? (
          <p className="text-sm text-ink-soft">No ingredients listed.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {ingredients.map((item, index) => {
              const amount = measure(item);
              return (
                // Two rows can share a key ("2 cups milk" and "1 cup milk" both key to
                // "milk"), so the index has to be part of the React key.
                <li key={`${item.key}-${index}`} className="flex gap-3 px-4 py-3">
                  {amount && (
                    <span className="w-24 shrink-0 font-semibold tabular-nums">{amount}</span>
                  )}
                  <span>{item.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Steps</h3>
        {steps.length === 0 ? (
          <p className="text-sm text-ink-soft">No steps written down.</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white"
                >
                  {index + 1}
                </span>
                <p className="pt-0.5 leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {recipe.notes && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Notes</h3>
          {/* Typed as one free-form block, so newlines are the cook's own formatting. */}
          <p className="whitespace-pre-line rounded-card border border-line bg-surface p-4 leading-relaxed">
            {recipe.notes}
          </p>
        </section>
      )}

      {recipe.sourceUrl && (
        <p className="text-sm">
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent underline"
          >
            Original recipe ↗
          </a>
        </p>
      )}
    </article>
  );
}

export default function RecipeDetailPage() {
  const { id } = useParams<'id'>();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!id) {
      setLoad({ status: 'missing' });
      return;
    }
    // A fast route change can resolve after teardown; `cancelled` keeps a stale doc from
    // overwriting the one the user actually navigated to.
    let cancelled = false;
    setLoad({ status: 'loading' });

    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'recipes', id));
        if (cancelled) return;
        setLoad(
          snap.exists()
            ? { status: 'ready', recipe: snap.data() as Recipe }
            : { status: 'missing' },
        );
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setLoad({ status: 'error' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <section className="space-y-4">
      <Link to="/recipe" className="inline-flex text-sm font-semibold text-ink-soft hover:text-ink">
        ← Cookbook
      </Link>

      {load.status === 'loading' && <p className="text-sm text-ink-soft">Loading…</p>}

      {load.status === 'missing' && (
        <p className="text-sm text-ink-soft">That recipe isn’t here anymore.</p>
      )}

      {load.status === 'error' && (
        <p role="alert" className="rounded-card border border-warn px-4 py-3 text-sm text-warn">
          Couldn’t load that recipe.
        </p>
      )}

      {load.status === 'ready' && <RecipeBody recipe={load.recipe} />}
    </section>
  );
}
