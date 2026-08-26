import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { StoreLocation } from '@grocery/shared';
import { findStores, isDemoStore } from './api';
import type { ConnectedStore } from './useStore';

/**
 * ZIP lookups are capped near 1,600/day across the whole account, and people retype the
 * same ZIP constantly. A per-session cache is the cheap half of the fix; the durable
 * shared cache belongs in the Function.
 */
const zipCache = new Map<string, StoreLocation[]>();

interface Props {
  currentLocationId: string | null;
  initialZip: string | null;
  onPick: (store: ConnectedStore, zip: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}

export default function StorePicker({
  currentLocationId,
  initialZip,
  onPick,
  onDisconnect,
  onClose,
}: Props) {
  const [zip, setZip] = useState(initialZip ?? '');
  const [stores, setStores] = useState<StoreLocation[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const trimmed = zip.trim();
    if (!/^\d{5}$/.test(trimmed)) {
      setStatus('error');
      setError('Enter a 5-digit ZIP code.');
      return;
    }
    const cached = zipCache.get(trimmed);
    if (cached) {
      setStores(cached);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const found = await findStores(trimmed);
      zipCache.set(trimmed, found);
      setStores(found);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Store lookup failed.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-picker-title"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg sm:rounded-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="store-picker-title" className="text-lg font-bold">
              Choose your store
            </h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              {isDemoStore
                ? 'Sample stores — this build has no connection to a real one.'
                : 'Prices and availability are per store.'}
            </p>
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

        <form onSubmit={search} className="mt-4 flex gap-2">
          <input
            ref={inputRef}
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            placeholder="ZIP code"
            aria-label="ZIP code"
            aria-invalid={status === 'error'}
            className="min-h-12 flex-1 rounded-card border border-line bg-bg px-4 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            className="min-h-12 rounded-card bg-accent px-5 font-semibold text-white disabled:opacity-50"
          >
            {status === 'loading' ? 'Finding…' : 'Find'}
          </button>
        </form>

        <div aria-live="polite" className="mt-3">
          {status === 'error' && <p className="text-sm font-medium text-warn">{error}</p>}
          {stores?.length === 0 && (
            <p className="text-sm text-ink-soft">No stores found near that ZIP.</p>
          )}
        </div>

        {stores && stores.length > 0 && (
          <ul className="mt-2 space-y-2">
            {stores.map((s) => {
              const isCurrent = s.locationId === currentLocationId;
              return (
                <li key={s.locationId}>
                  <button
                    type="button"
                    onClick={() => {
                      void onPick({ locationId: s.locationId, name: s.name }, zip.trim());
                      onClose();
                    }}
                    className={`w-full rounded-card border p-3 text-left transition-colors ${
                      isCurrent ? 'border-accent bg-accent/5' : 'border-line hover:border-accent'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.name}</span>
                      {isCurrent && (
                        <span className="shrink-0 text-xs font-bold text-accent">Connected</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-soft">{s.address}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {currentLocationId !== null && (
          <button
            type="button"
            onClick={() => {
              void onDisconnect();
              onClose();
            }}
            className="mt-4 min-h-12 w-full rounded-card border border-line font-semibold text-ink-soft hover:text-warn"
          >
            Shop without a store
          </button>
        )}

        <p className="mt-4 text-center text-xs text-ink-soft">
          Your list works fine without a store. Connecting one adds prices and cart sending.
        </p>
      </div>
    </div>
  );
}
