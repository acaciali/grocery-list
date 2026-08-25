import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, type GroceryItem, type StoreProduct } from '@grocery/shared';
import AddItemCombobox from './AddItemCombobox';
import GroceryList from './GroceryList';
import MatchPicker from './MatchPicker';
import StorePicker from './StorePicker';
import { useConnectedStore } from './useStore';
import {
  addMatchedItem,
  addPlainItem,
  clearChecked,
  deleteItem,
  setMatch,
  toggleItem,
  type Row,
} from './data';

export default function GroceryPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const { store, zip, loading: storeLoading, connect } = useConnectedStore();

  useEffect(() => {
    const q = query(collection(db, 'groceries'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setItems(
        snap.docs.map((d) => ({
          id: d.id,
          // 'estimate' fills the local-echo null from serverTimestamp() so a freshly
          // added row doesn't jump position when the server round-trip lands.
          ...(d.data({ serverTimestamps: 'estimate' }) as GroceryItem),
        })),
      );
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function guard(work: () => Promise<unknown>, failure: string) {
    try {
      await work();
    } catch (err) {
      console.error(err);
      setToast({ msg: failure, kind: 'error' });
    }
  }

  const matchingRow = items.find((i) => i.id === matchingId) ?? null;

  /**
   * Only counts items we have a price for, and says so. A total that silently omits
   * three unmatched items reads as complete and is simply wrong.
   */
  const estimate = useMemo(() => {
    let total = 0;
    let priced = 0;
    let unpriced = 0;
    for (const row of items) {
      if (row.checked) continue;
      const p = row.match?.product;
      const price = p?.promoPrice ?? p?.price;
      if (row.match?.status === 'matched' && price != null) {
        total += price * (row.match.cartQuantity ?? 1);
        priced += 1;
      } else {
        unpriced += 1;
      }
    }
    return { total, priced, unpriced };
  }, [items]);

  const checkedCount = items.filter((i) => i.checked).length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        {storeLoading ? (
          <span className="text-sm text-ink-soft">…</span>
        ) : (
          <button
            type="button"
            onClick={() => setStorePickerOpen(true)}
            className="min-w-0 truncate rounded-card border border-line bg-surface px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
          >
            {store ? (
              <>
                <span aria-hidden="true">📍 </span>
                <span className="font-semibold text-ink">{store.name}</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">📍 </span>Connect a store
              </>
            )}
          </button>
        )}
        {estimate.priced > 0 && (
          <span className="shrink-0 text-sm tabular-nums text-ink-soft">
            est.{' '}
            <span className="font-bold text-ink">${estimate.total.toFixed(2)}</span>
            {estimate.unpriced > 0 && (
              <span className="ml-1 text-xs">· {estimate.unpriced} not priced</span>
            )}
          </span>
        )}
      </div>

      <AddItemCombobox
        locationId={store?.locationId ?? null}
        onAddPlain={(raw) => guard(() => addPlainItem(raw), "Couldn't add")}
        onAddProduct={(raw: string, product: StoreProduct) =>
          guard(
            () => addMatchedItem(raw, product, store?.locationId ?? ''),
            "Couldn't add",
          )
        }
      />

      <div className="mt-4">
        <GroceryList
          items={items}
          grouped={store !== null}
          onToggle={(row) => void guard(() => toggleItem(row), "Couldn't update")}
          onDelete={(id) => void guard(() => deleteItem(id), "Couldn't delete")}
          onOpenMatch={(row) => (store ? setMatchingId(row.id) : setStorePickerOpen(true))}
        />
      </div>

      {checkedCount > 0 && (
        <button
          type="button"
          onClick={() =>
            void guard(async () => {
              const n = await clearChecked(items);
              setToast({ msg: `Cleared ${n} item${n === 1 ? '' : 's'}`, kind: 'info' });
            }, "Couldn't clear")
          }
          className="mt-4 min-h-12 w-full rounded-card border border-line bg-surface font-semibold text-ink-soft hover:text-warn"
        >
          Clear {checkedCount} checked
        </button>
      )}

      {storePickerOpen && (
        <StorePicker
          currentLocationId={store?.locationId ?? null}
          initialZip={zip}
          onPick={(next, pickedZip) =>
            guard(() => connect(next, pickedZip), "Couldn't save your store")
          }
          onClose={() => setStorePickerOpen(false)}
        />
      )}

      {matchingRow && store && (
        <MatchPicker
          row={matchingRow}
          locationId={store.locationId}
          onChoose={(match) =>
            guard(() => setMatch(matchingRow.id, match), "Couldn't save that choice")
          }
          onClose={() => setMatchingId(null)}
        />
      )}

      {toast && (
        <p
          role="status"
          className={`fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-card px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-warn' : 'bg-ink'
          }`}
        >
          {toast.msg}
        </p>
      )}
    </section>
  );
}
