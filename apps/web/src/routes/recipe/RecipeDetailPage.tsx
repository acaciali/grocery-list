/**
 * One recipe. A stub for now -- it loads the doc so the page is titled and a bad id is
 * reported honestly, but the body (ingredients, steps, notes, "add missing to groceries")
 * is still to come. Read once rather than subscribed: a recipe does not change under you.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, type Recipe } from '@grocery/shared';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; recipe: Recipe }
  | { status: 'missing' }
  | { status: 'error' };

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

      {load.status === 'ready' && (
        <>
          <h2 className="text-xl font-bold tracking-tight">{load.recipe.title}</h2>
          <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
            <p className="text-sm text-ink-soft">
              The full recipe view lands here — ingredients, steps and notes.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
