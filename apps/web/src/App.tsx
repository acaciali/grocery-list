import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ensureSignedIn } from '@grocery/shared';
import GroceryPage from './routes/grocery/GroceryPage';
import InventoryPage from './routes/inventory/InventoryPage';
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
 */
let signInOnce: Promise<unknown> | null = null;

type AuthState = 'pending' | 'ready' | 'failed';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('pending');

  useEffect(() => {
    let cancelled = false;
    signInOnce ??= ensureSignedIn();
    signInOnce.then(
      () => !cancelled && setAuthState('ready'),
      (err: unknown) => {
        console.error('Anonymous sign-in failed', err);
        // Let the next mount retry rather than caching the rejection forever.
        signInOnce = null;
        if (!cancelled) setAuthState('failed');
      },
    );
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
        {authState === 'pending' && (
          <p role="status" className="py-12 text-center text-sm text-ink-soft">
            Signing in…
          </p>
        )}
        {authState === 'failed' && (
          <div className="rounded-card border border-line bg-surface p-6 text-center">
            <p className="font-semibold text-warn">Couldn&apos;t sign in</p>
            <p className="mt-1 text-sm text-ink-soft">
              Your list needs a connection to load. Check your network and reload.
            </p>
          </div>
        )}
        {authState === 'ready' && (
          <Routes>
            <Route path="/" element={<Navigate to="/grocery" replace />} />
            <Route path="/recipe" element={<RecipePage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/grocery" element={<GroceryPage />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
