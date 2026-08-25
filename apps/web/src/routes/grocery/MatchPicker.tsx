import { useEffect, useRef, useState } from 'react';
import type { StoreMatch, StoreProduct } from '@grocery/shared';
import { searchProducts } from './api';
import { matchFromProduct, type Row } from './data';

interface Props {
  row: Row;
  locationId: string;
  onChoose: (match: StoreMatch) => Promise<void>;
  onClose: () => void;
}

/**
 * Correct or clear a single item's store match.
 *
 * "Not sold here" is a first-class outcome, not a failure. Without it, a birthday card
 * on the grocery list gets re-flagged every time the list resolves, forever.
 */
export default function MatchPicker({ row, locationId, onChoose, onClose }: Props) {
  const [results, setResults] = useState<StoreProduct[]>(row.match?.candidates ?? []);
  const [query, setQuery] = useState(row.name);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>(
    (row.match?.candidates?.length ?? 0) > 0 ? 'idle' : 'loading',
  );
  const ranInitialSearch = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (ranInitialSearch.current || (row.match?.candidates?.length ?? 0) > 0) return;
    ranInitialSearch.current = true;
    void runSearch(row.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(term: string) {
    setStatus('loading');
    try {
      setResults(await searchProducts(term, locationId));
      setStatus('idle');
    } catch (err) {
      console.error('match search failed', err);
      setStatus('error');
    }
  }

  const currentId = row.match?.product?.productId ?? null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-picker-title"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg sm:rounded-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="match-picker-title" className="truncate text-lg font-bold">
              {row.name}
            </h2>
            <p className="mt-0.5 text-sm text-ink-soft">Pick the product to buy.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 size-10 shrink-0 rounded-card text-xl text-ink-soft hover:text-ink"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query.trim());
          }}
          className="mt-4 flex gap-2"
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
              Nothing matched “{query}”. Try different words, or mark it as something the
              store doesn&apos;t sell.
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
                      void onChoose(matchFromProduct(p, locationId));
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 rounded-card border p-2.5 text-left transition-colors ${
                      isCurrent ? 'border-accent bg-accent/5' : 'border-line hover:border-accent'
                    }`}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="size-12 shrink-0 rounded object-contain" />
                    ) : (
                      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded bg-bg">
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

        <div className="mt-4 border-t border-line pt-3">
          {row.match?.status === 'not_sold' ? (
            <button
              type="button"
              onClick={() => {
                void onChoose({ status: 'unresolved', locationId, product: null });
                onClose();
              }}
              className="w-full min-h-12 rounded-card border border-line font-semibold text-ink-soft hover:text-ink"
            >
              Check the store for this again
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                // Sticky and store-independent: a statement about the item, not the store.
                void onChoose({ status: 'not_sold', locationId: null, product: null });
                onClose();
              }}
              className="w-full min-h-12 rounded-card border border-line font-semibold text-ink-soft hover:text-ink"
            >
              The store doesn&apos;t sell this
            </button>
          )}
          <p className="mt-2 text-center text-xs text-ink-soft">
            Either way it stays on your list — you just won&apos;t be asked again.
          </p>
        </div>
      </div>
    </div>
  );
}
