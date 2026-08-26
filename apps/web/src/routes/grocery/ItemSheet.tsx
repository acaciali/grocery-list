import { useEffect, useRef, useState } from 'react';
import type { StoreMatch, StoreProduct, Unit } from '@grocery/shared';
import { searchProducts } from './api';
import { matchFromProduct, type Row } from './data';

const UNITS: Unit[] = [
  'each', 'g', 'kg', 'oz', 'lb', 'ml', 'l',
  'tsp', 'tbsp', 'cup', 'clove', 'can', 'pkg',
  'gal', 'dozen', 'bunch', 'bag',
];

const MAX_CART_QUANTITY = 99;

interface Props {
  row: Row;
  locationId: string | null;
  onChoose: (match: StoreMatch) => Promise<void>;
  onAmount: (quantity: number | null, unit: Unit | null) => Promise<void>;
  onCartQuantity: (packages: number) => Promise<void>;
  onConnectStore: () => void;
  onClose: () => void;
}

/**
 * Everything you can do to one list item: how much you want, which store product it is,
 * and how many packages of it to buy.
 *
 * It opens without a store connected too. Editing an amount has nothing to do with Kroger,
 * and gating it behind a store connection would make the list worse for anyone who never
 * connects one.
 *
 * "Not sold here" is a first-class outcome, not a failure. Without it, a birthday card on
 * the grocery list gets re-flagged every time the list resolves, forever.
 */
export default function ItemSheet({
  row,
  locationId,
  onChoose,
  onAmount,
  onCartQuantity,
  onConnectStore,
  onClose,
}: Props) {
  const [results, setResults] = useState<StoreProduct[]>(row.match?.candidates ?? []);
  const [query, setQuery] = useState(row.name);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const ranInitialSearch = useRef(false);

  const [quantity, setQuantity] = useState(row.quantity == null ? '' : String(row.quantity));
  const [unit, setUnit] = useState<Unit | ''>(row.unit ?? '');

  // Amount edits save on blur and on close rather than on every keystroke: a number input
  // passes through states like "" and "1." that are not what anyone means to store.
  const committed = useRef({ quantity: row.quantity ?? null, unit: row.unit ?? null });
  function commitAmount(nextUnit: Unit | '' = unit) {
    const parsed = quantity.trim() === '' ? null : Number(quantity);
    const value = parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    const unitValue = nextUnit === '' ? null : nextUnit;
    if (value === committed.current.quantity && unitValue === committed.current.unit) return;
    committed.current = { quantity: value, unit: unitValue };
    void onAmount(value, unitValue);
  }

  function close() {
    commitAmount();
    onClose();
  }
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (locationId === null || ranInitialSearch.current) return;
    if ((row.match?.candidates?.length ?? 0) > 0) return;
    ranInitialSearch.current = true;
    void runSearch(row.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  async function runSearch(term: string) {
    if (locationId === null) return;
    setStatus('loading');
    try {
      setResults(await searchProducts(term, locationId));
      setStatus('idle');
    } catch (err) {
      console.error('match search failed', err);
      setStatus('error');
    }
  }

  const match = row.match;
  const product = match?.product ?? null;
  const currentId = product?.productId ?? null;
  const packages = match?.cartQuantity ?? 1;

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-sheet-title"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg sm:rounded-card"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="item-sheet-title" className="min-w-0 truncate text-lg font-bold">
            {row.name}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-1 -mt-1 size-10 shrink-0 rounded-card text-xl text-ink-soft hover:text-ink"
          >
            ×
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-bold uppercase tracking-wide text-ink-soft">
            How much
          </legend>
          <div className="mt-2 flex gap-2">
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onBlur={() => commitAmount()}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="Any"
              aria-label={`Quantity of ${row.name}`}
              className="min-h-12 w-24 rounded-card border border-line bg-bg px-4 tabular-nums outline-none focus:border-accent"
            />
            <select
              value={unit}
              onChange={(e) => {
                const next = e.target.value as Unit | '';
                setUnit(next);
                commitAmount(next);
              }}
              aria-label={`Unit for ${row.name}`}
              className="min-h-12 flex-1 rounded-card border border-line bg-bg px-3 outline-none focus:border-accent"
            >
              <option value="">no unit</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        {locationId === null ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-ink-soft">
              Connect a store to see prices for this item and send it to a cart.
            </p>
            <button
              type="button"
              onClick={() => {
                commitAmount();
                onConnectStore();
              }}
              className="mt-2 min-h-12 w-full rounded-card border border-line font-semibold text-ink-soft hover:text-ink"
            >
              Connect a store
            </button>
          </div>
        ) : (
          <>
            {product && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                  Packages to buy
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void onCartQuantity(Math.max(1, packages - 1))}
                    disabled={packages <= 1}
                    aria-label="One package fewer"
                    className="size-12 shrink-0 rounded-card border border-line text-xl font-semibold text-ink-soft disabled:opacity-40 hover:text-ink"
                  >
                    −
                  </button>
                  <span
                    aria-live="polite"
                    className="w-10 text-center text-lg font-bold tabular-nums"
                  >
                    {packages}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void onCartQuantity(Math.min(MAX_CART_QUANTITY, packages + 1))
                    }
                    disabled={packages >= MAX_CART_QUANTITY}
                    aria-label="One package more"
                    className="size-12 shrink-0 rounded-card border border-line text-xl font-semibold text-ink-soft disabled:opacity-40 hover:text-ink"
                  >
                    +
                  </button>
                  {/* The whole point of this control: 2 lb of chicken is not 2 packages. */}
                  <span className="min-w-0 flex-1 text-sm text-ink-soft">
                    {product.size ? `${product.size} each` : 'Package size unknown'}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                Which product
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch(query.trim());
                }}
                className="mt-2 flex gap-2"
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search the store"
                  className="min-h-12 flex-1 rounded-card border border-line bg-bg px-4 outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  className="min-h-12 rounded-card border border-line px-4 font-semibold text-ink-soft hover:text-ink"
                >
                  Search
                </button>
              </form>

              <div aria-live="polite" className="mt-3">
                {status === 'loading' && <p className="text-sm text-ink-soft">Searching…</p>}
                {status === 'error' && (
                  <p className="text-sm font-medium text-warn">
                    Couldn&apos;t reach the store. The item stays on your list either way.
                  </p>
                )}
                {status === 'idle' && results.length === 0 && (
                  <p className="text-sm text-ink-soft">
                    Nothing matched “{query}”. Try different words, or mark it as something
                    the store doesn&apos;t sell.
                  </p>
                )}
              </div>

              {results.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {results.map((p) => {
                    const out = p.stockLevel === 'TEMPORARILY_OUT_OF_STOCK';
                    const isCurrent = p.productId === currentId;
                    return (
                      <li key={p.productId}>
                        <button
                          type="button"
                          onClick={() => {
                            commitAmount();
                            void onChoose(matchFromProduct(p, locationId));
                            onClose();
                          }}
                          className={`flex w-full items-center gap-3 rounded-card border p-2.5 text-left transition-colors ${
                            isCurrent
                              ? 'border-accent bg-accent/5'
                              : 'border-line hover:border-accent'
                          }`}
                        >
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt=""
                              className="size-12 shrink-0 rounded object-contain"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="grid size-12 shrink-0 place-items-center rounded bg-bg"
                            >
                              🛒
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.name}</span>
                            <span className="block truncate text-xs text-ink-soft">
                              {[p.size, out ? 'Out of stock' : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {p.price != null && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              ${(p.promoPrice ?? p.price).toFixed(2)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-4 border-t border-line pt-3">
              {match?.status === 'not_sold' ? (
                <button
                  type="button"
                  onClick={() => {
                    // Stays open and searches straight away -- the user asked to look again,
                    // so showing them the answer beats closing and making them reopen.
                    void onChoose({ status: 'unresolved', locationId, product: null });
                    void runSearch(row.name);
                  }}
                  className="min-h-12 w-full rounded-card border border-line font-semibold text-ink-soft hover:text-ink"
                >
                  Check the store for this again
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    commitAmount();
                    // Sticky and store-independent: a statement about the item, not the store.
                    void onChoose({ status: 'not_sold', locationId: null, product: null });
                    onClose();
                  }}
                  className="min-h-12 w-full rounded-card border border-line font-semibold text-ink-soft hover:text-ink"
                >
                  The store doesn&apos;t sell this
                </button>
              )}
              <p className="mt-2 text-center text-xs text-ink-soft">
                Either way it stays on your list — you just won&apos;t be asked again.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
