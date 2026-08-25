import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import GroceryPage from './routes/grocery/GroceryPage';
import InventoryPage from './routes/inventory/InventoryPage';
import RecipePage from './routes/recipe/RecipePage';

const tabs = [
  { to: '/recipe', label: 'Recipes', emoji: '🍳' },
  { to: '/inventory', label: 'Pantry', emoji: '🥫' },
  { to: '/grocery', label: 'Groceries', emoji: '🛒' },
];

export default function App() {
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
        <Routes>
          <Route path="/" element={<Navigate to="/grocery" replace />} />
          <Route path="/recipe" element={<RecipePage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/grocery" element={<GroceryPage />} />
        </Routes>
      </main>
    </div>
  );
}
