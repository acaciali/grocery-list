/**
 * The cookbook: every saved recipe as a tile, newest first. Tapping a tile opens
 * /recipe/:id. Manual entry moved to /recipe/new so this route is the way in.
 */
import { Link } from 'react-router-dom';
import { useRecipes, type RecipeRow } from './useRecipes';

/** The one line of context under a tile's name: how big, how long. Blank when unknown. */
function tileMeta(recipe: RecipeRow): string {
  const parts: string[] = [];
  const count = recipe.ingredients?.length ?? 0;
  if (count > 0) parts.push(`${count} ingredient${count === 1 ? '' : 's'}`);
  if (recipe.totalMinutes) parts.push(`${recipe.totalMinutes} min`);
  return parts.join(' · ');
}

export default function RecipeListPage() {
  const { rows, loading, error } = useRecipes();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Cookbook</h2>
        <Link
          to="/recipe/new"
          className="flex min-h-12 items-center rounded-card bg-accent px-4 text-sm font-semibold text-white active:opacity-80"
        >
          + New recipe
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-card border border-warn px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-ink-soft">Loading recipes…</p>}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-4xl" aria-hidden="true">
            🍳
          </p>
          <h3 className="mt-3 text-base font-bold">No recipes yet</h3>
          <p className="mt-2 text-sm text-ink-soft">
            Add your first one and it shows up here.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {rows.map((recipe) => {
            const meta = tileMeta(recipe);
            return (
              <li key={recipe.id}>
                <Link
                  to={`/recipe/${recipe.id}`}
                  className="flex h-full min-h-32 flex-col justify-end gap-1 overflow-hidden rounded-card border border-line bg-surface p-4 shadow-sm transition-colors hover:border-accent"
                >
                  <span className="line-clamp-3 text-base font-semibold leading-snug">
                    {recipe.title}
                  </span>
                  {meta && <span className="text-xs text-ink-soft">{meta}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
