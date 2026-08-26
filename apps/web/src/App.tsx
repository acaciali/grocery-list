import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ensureSignedIn } from '@grocery/shared';
import GroceryPage from './routes/grocery/GroceryPage';
import InventoryPage from './routes/inventory/InventoryPage';
import RecipeDetailPage from './routes/recipe/RecipeDetailPage';
import RecipeListPage from './routes/recipe/RecipeListPage';
import RecipePage from './routes/recipe/RecipePage';

const tabs = [
  { to: '/recipe', label: 'Recipes', emoji: '🍳' },
  { to: '/inventory', label: 'Pantry', emoji: '🥫' },
  { to: '/grocery', label: 'Groceries', emoji: '🛒' },
];

/**
 * Shared across a StrictMode double-invoked effect. Without it, two concurrent calls
 * both see a null currentUser and sign in twice, creating a second anonymous uid whose
 * pantry and store prefs are silently orphaned.
 *
 * Sign-in deliberately does NOT gate the routes. The grocery list predates auth and its
 * Firestore rules are open; blocking it on a sign-in that can fail (anonymous auth not
 * enabled, network down) would regress an app someone actually uses.
 */
let signInOnce: Promise<unknown> | null = null;

export default function App() {
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signInOnce ??= ensureSignedIn();
    signInOnce.catch((err: unknown) => {
      console.error('Anonymous sign-in failed', err);
      // Let the next mount retry rather than caching the rejection forever.
      signInOnce = null;
      if (!cancelled) setAuthFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-[env(safe-area-inset-bottom)]">
      <header className="py-4">
        <h1 className="text-center text-xl font-bold tracking-tight">Kitchen Loop</h1>
        <nav className="mt-3 grid grid-cols-3 gap-2" aria-label="Sections">
          {tabs.map(({ to, label, emoji }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex min-h-12 items-center justify-center gap-1.5 rounded-card border text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-surface text-ink-soft hover:text-ink'
                }`
              }
            >
              <span aria-hidden="true">{emoji}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 pb-6">
        {/* Hidden until anonymous auth is enabled for grocery-list-3dd86 (Firebase console →
            Authentication → Sign-in method → Anonymous). Until then it fires on every load.
        {authFailed && (
          <p
            role="status"
            className="mb-3 rounded-card border border-line bg-surface px-3 py-2 text-center text-xs text-ink-soft"
          >
            Signed out — your list still works, but saved preferences won&apos;t stick.
          </p>
        )} */}
        <Routes>
          <Route path="/" element={<Navigate to="/grocery" replace />} />
          <Route path="/recipe" element={<RecipeListPage />} />
          {/* Before the :id route, or "new" reads as a doc id. */}
          <Route path="/recipe/new" element={<RecipePage />} />
          <Route path="/recipe/:id" element={<RecipeDetailPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/grocery" element={<GroceryPage />} />
        </Routes>
      </main>
    </div>
  );
}
