/**
 * React + TS port of the original vanilla groceries.js. Feature parity, nothing more:
 * add, check off, delete, clear-checked, real-time sync. The Grocery team upgrades this
 * to the full Item shape in Phase 1.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, type GroceryItem } from '@grocery/shared';

type Row = GroceryItem & { id: string };

export default function GroceryPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const q = query(collection(db, 'groceries'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setItems(
        snap.docs.map((d) => ({
          id: d.id,
          // 'estimate' fills the local-echo null from serverTimestamp() so a freshly
          // added row doesn't jump position when the server round-trip lands.
          ...(d.data({ serverTimestamps: 'estimate' }) as GroceryItem),
        })),
      );
    });
    return unsubscribe;
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(msg: string, kind: 'info' | 'error' = 'info') {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    setDraft('');
    try {
      await addDoc(collection(db, 'groceries'), {
        name,
        checked: false,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      showToast("Couldn't add", 'error');
    }
  }

  async function toggleItem(item: Row) {
    try {
      await updateDoc(doc(db, 'groceries', item.id), { checked: !item.checked });
    } catch (err) {
      console.error(err);
      showToast("Couldn't update", 'error');
    }
  }

  async function deleteItem(id: string) {
    try {
      await deleteDoc(doc(db, 'groceries', id));
    } catch (err) {
      console.error(err);
      showToast("Couldn't delete", 'error');
    }
  }

  async function clearChecked() {
    const checked = items.filter((i) => i.checked);
    if (checked.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const item of checked) batch.delete(doc(db, 'groceries', item.id));
      await batch.commit();
      showToast(`Cleared ${checked.length} item${checked.length === 1 ? '' : 's'}`);
    } catch (err) {
      console.error(err);
      showToast("Couldn't clear", 'error');
    }
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const ordered = [...unchecked, ...checked];

  return (
    <section>
      <form onSubmit={addItem} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an item…"
          aria-label="New grocery item"
          className="min-h-12 flex-1 rounded-card border border-line bg-surface px-4 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="min-h-12 rounded-card bg-accent px-5 font-semibold text-white active:opacity-80"
        >
          Add
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {ordered.length === 0 && (
          <li className="rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-soft">
            Nothing on the list. Add the first item.
          </li>
        )}
        {ordered.map((item) => (
          <li
            key={item.id}
            className={`flex items-center rounded-card border border-line bg-surface shadow-sm ${
              item.checked ? 'opacity-60' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => toggleItem(item)}
              aria-label={`${item.checked ? 'Uncheck' : 'Check'} ${item.name}`}
              className="flex min-h-12 flex-1 items-center gap-3 px-4 text-left"
            >
              <span
                aria-hidden="true"
                className={`grid size-5 shrink-0 place-items-center rounded-full border text-xs text-white ${
                  item.checked ? 'border-accent bg-accent' : 'border-ink-soft'
                }`}
              >
                {item.checked ? '✓' : ''}
              </span>
              <span className={item.checked ? 'line-through' : ''}>{item.name}</span>
            </button>
            <button
              type="button"
              onClick={() => deleteItem(item.id)}
              aria-label={`Delete ${item.name}`}
              className="min-h-12 px-4 text-lg text-ink-soft hover:text-warn"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {checked.length > 0 && (
        <button
          type="button"
          onClick={clearChecked}
          className="mt-4 w-full min-h-12 rounded-card border border-line bg-surface font-semibold text-ink-soft hover:text-warn"
        >
          Clear checked
        </button>
      )}

      {toast && (
        <p
          role="status"
          className={`fixed inset-x-4 bottom-4 mx-auto max-w-md rounded-card px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-warn' : 'bg-ink'
          }`}
        >
          {toast.msg}
        </p>
      )}
    </section>
  );
}
