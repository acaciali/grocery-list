import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { StoreProduct } from '@grocery/shared';
import { searchProducts } from './api';

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

interface Props {
  locationId: string | null;
  onAddPlain: (raw: string) => Promise<void>;
  onAddProduct: (raw: string, product: StoreProduct) => Promise<void>;
}

/**
 * Type-ahead add.
 *
 * Two rules keep it from fighting fast typing:
 *   1. Enter with nothing highlighted always adds plain text. Hijacking Enter to take
 *      the top result is how comboboxes become infuriating -- you type "milk", hit
 *      Enter, and get whatever the store ranked first.
 *   2. With no store connected it degrades to a plain input: no dropdown, no spinner,
 *      no error. The list has to stay fully usable with zero store integration.
 */
export default function AddItemCombobox({ locationId, onAddPlain, onAddProduct }: Props) {
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState<StoreProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 = nothing highlighted; Enter adds plain
  const [searching, setSearching] = useState(false);

  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  // Prefix-keyed so backspacing through a query is instant and costs no requests.
  const cache = useRef(new Map<string, StoreProduct[]>());

  const query = draft.trim();
  const canSearch = locationId !== null && query.length >= MIN_QUERY;

  useEffect(() => {
    if (!canSearch || locationId === null) {
      setResults([]);
      setSearching(false);
      return;
    }
    const cached = cache.current.get(query);
    if (cached) {
      setResults(cached);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchProducts(query, locationId, controller.signal)
        .then((products) => {
          cache.current.set(query, products);
          setResults(products);
          setSearching(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          // A store lookup failing must never block adding the item as text.
          console.error('product search failed', err);
          setResults([]);
          setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, locationId, canSearch]);

  // Any change to the result set invalidates whatever row was highlighted.
  useEffect(() => setActive(-1), [results]);

  async function commit(product: StoreProduct | null) {
    const raw = draft.trim();
    if (!raw) return;
    setDraft('');
    setResults([]);
    setOpen(false);
    setActive(-1);
    await (product ? onAddProduct(raw, product) : onAddPlain(raw));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void commit(active >= 0 ? (results[active] ?? null) : null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setActive(-1);
      setOpen(false);
    }
  }

  const showList = open && canSearch && (results.length > 0 || searching);

  return (
    <div className="relative">
      <form onSubmit={onSubmit} className="flex gap-2" autoComplete="off">
        <div
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-haspopup="listbox"
          className="flex-1"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            placeholder={locationId ? 'Add an item…' : 'Add an item…'}
            aria-label="New grocery item"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            className="min-h-12 w-full rounded-card border border-line bg-surface px-4 text-base outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          className="min-h-12 shrink-0 rounded-card bg-accent px-5 font-semibold text-white active:opacity-80"
        >
          Add
        </button>
      </form>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Store products"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-lg"
        >
          {searching && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-soft">Searching…</li>
          )}
          {results.map((p, i) => (
            <li
              key={p.productId}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void commit(p)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
                i === active ? 'bg-accent/10' : ''
              }`}
            >
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="size-10 shrink-0 rounded object-contain" />
              ) : (
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded bg-bg text-ink-soft">
                  🛒
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-ink-soft">
                  {[p.size, p.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? 'Out of stock' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {p.price != null && (
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  ${(p.promoPrice ?? p.price).toFixed(2)}
                </span>
              )}
            </li>
          ))}
          <li
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void commit(null)}
            className="mt-1 cursor-pointer border-t border-line px-4 py-2.5 text-sm text-ink-soft hover:text-ink"
          >
            <span aria-hidden="true">✎ </span>
            Add “{query}” as plain text
          </li>
        </ul>
      )}
    </div>
  );
}
