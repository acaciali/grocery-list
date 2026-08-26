import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  db,
  type GroceryItem,
  type StoreMatch,
  type StoreProduct,
  type Unit,
} from '@grocery/shared';
import AddItemCombobox from './AddItemCombobox';
import CartPanel from './CartPanel';
import DemoBadge from './DemoBadge';
import GroceryList from './GroceryList';
import ItemSheet from './ItemSheet';
import StorePicker from './StorePicker';
import { isDemoStore, rememberChoice } from './api';
import { useConnectedStore } from './useStore';
import { useMatchSync } from './useMatchSync';
import {
  addMatchedItem,
  addPlainItem,
  clearChecked,
  deleteItem,
  setAmount,
  setCartQuantity,
  setMatch,
  toggleItem,
  type AddResult,
  type Row,
} from './data';

const AMOUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function mergeMessage(result: AddResult): string {
  const amount = [
    result.quantity == null ? null : AMOUNT_FORMAT.format(result.quantity),
    result.unit,
  ]
    .filter(Boolean)
    .join(' ');
  return `Already on your list — now ${amount} ${result.name}`.trim();
}

export default function GroceryPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const { store, zip, uid, loading: storeLoading, connect, disconnect } = useConnectedStore();
  const locationId = store?.locationId ?? null;

  const { resolvingIds, announcement, staleCount, dismissStale, retry } = useMatchSync(
    items,
    locationId,
    uid,
  );

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

  async function add(work: () => Promise<AddResult>) {
    await guard(async () => {
      const result = await work();
      if (result.merged) setToast({ msg: mergeMessage(result), kind: 'info' });
    }, "Couldn't add");
  }

  async function chooseMatch(row: Row, match: StoreMatch) {
    await setMatch(row.id, match);
    if (match.status === 'unresolved') retry(row.id);
    if (uid && match.chosenBy === 'user' && match.product) {
      // Best-effort. A failed memory costs a better guess next time, never this choice.
      rememberChoice(uid, row.name, match.product).catch((err) =>
        console.error('rememberChoice failed', err),
      );
    }
  }

  const sheetRow = items.find((i) => i.id === sheetId) ?? null;

  // 'resolving' is this tab's network state, not data, so it is layered on for display
  // rather than written to Firestore where a closed tab would strand it.
  const displayItems = useMemo(() => {
    if (resolvingIds.size === 0) return items;
    return items.map((row) =>
      resolvingIds.has(row.id)
        ? { ...row, match: { status: 'resolving' as const, locationId } }
        : row,
    );
  }, [items, resolvingIds, locationId]);

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
      // 'sent' counts too: the item is still on the list and still costs money. Dropping it
      // here would make the estimate fall every time you sent something to the cart.
      const priceable = row.match?.status === 'matched' || row.match?.status === 'sent';
      if (priceable && price != null) {
        total += price * (row.match?.cartQuantity ?? 1);
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
                {isDemoStore && <DemoBadge />}
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
            est. <span className="font-bold text-ink">${estimate.total.toFixed(2)}</span>
            {estimate.unpriced > 0 && (
              <span className="ml-1 text-xs">· {estimate.unpriced} not priced</span>
            )}
          </span>
        )}
      </div>

      {staleCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 text-sm">
          <span aria-hidden="true">📍</span>
          <span className="min-w-0 flex-1 text-ink-soft">
            Store changed · {staleCount} item{staleCount === 1 ? '' : 's'} being re-checked
          </span>
          <button
            type="button"
            onClick={dismissStale}
            className="shrink-0 font-semibold text-ink-soft hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      <AddItemCombobox
        locationId={locationId}
        onAddPlain={(raw) => add(() => addPlainItem(raw, items))}
        onAddProduct={(raw: string, product: StoreProduct) =>
          add(() => addMatchedItem(raw, product, locationId ?? '', items))
        }
      />

      <div className="mt-4">
        <GroceryList
          items={displayItems}
          hasStore={store !== null}
          onToggle={(row) => void guard(() => toggleItem(row), "Couldn't update")}
          onDelete={(id) => void guard(() => deleteItem(id), "Couldn't delete")}
          onOpen={(row) => setSheetId(row.id)}
        />
      </div>

      <CartPanel items={items} locationId={locationId} storeName={store?.name ?? null} uid={uid} />

      {/* Background resolution is otherwise completely invisible without sight. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

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
          currentLocationId={locationId}
          initialZip={zip}
          onPick={(next, pickedZip) =>
            guard(() => connect(next, pickedZip), "Couldn't save your store")
          }
          onDisconnect={() => guard(() => disconnect(), "Couldn't disconnect")}
          onClose={() => setStorePickerOpen(false)}
        />
      )}

      {sheetRow && (
        <ItemSheet
          row={sheetRow}
          locationId={locationId}
          onChoose={(match) =>
            guard(() => chooseMatch(sheetRow, match), "Couldn't save that choice")
          }
          onAmount={(quantity: number | null, unit: Unit | null) =>
            guard(() => setAmount(sheetRow.id, quantity, unit), "Couldn't save the amount")
          }
          onCartQuantity={(packages) =>
            guard(
              () => setCartQuantity(sheetRow.id, sheetRow.match ?? { status: 'unresolved', locationId }, packages),
              "Couldn't change the count",
            )
          }
          onConnectStore={() => {
            setSheetId(null);
            setStorePickerOpen(true);
          }}
          onClose={() => setSheetId(null)}
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
