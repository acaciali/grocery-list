/**
 * ➕ Add to the pantry, on its own page. Split out from the list so the list is just the
 * list: adding is a deliberate trip rather than a form sitting above your food forever.
 *
 * Everything that puts food IN lives here -- typed form, one-tap staples, shelf photo.
 * Saving returns you to the list and hands it the toast, because the message belongs to
 * the page you land on, not the one you left.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AddItemForm from './AddItemForm';
import ShelfCapture from './ShelfCapture';
import { useInventory } from './useInventory';
import { ToastBar, useToast } from './useToast';

export default function AddItemPage() {
  const { rows, uid, loading, error } = useInventory();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();
  const [scanning, setScanning] = useState(false);
  // The last thing we said, so a save can carry it back to the list. onAdded always fires
  // immediately before onSaved, so this is current by the time we navigate.
  const lastMsg = useRef('Added to your pantry');

  function announce(msg: string) {
    lastMsg.current = msg;
    showToast(msg);
  }

  function backToList(msg?: string) {
    navigate('/inventory', { state: { toast: msg ?? lastMsg.current } });
  }

  const back = (
    <Link
      to="/inventory"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-accent"
    >
      ← Pantry
    </Link>
  );

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        {back}
        <h2 className="font-bold">Add an item</h2>
      </div>

      <div className="mt-2">
        {loading ? (
          <p className="rounded-card border border-line bg-surface p-8 text-center text-sm text-ink-soft">
            Loading your pantry…
          </p>
        ) : error ? (
          <p className="rounded-card border border-warn/30 bg-warn/10 p-6 text-center text-sm text-warn">
            {error}
          </p>
        ) : !uid ? (
          // uid is non-null once loading is false with no error, but the compiler can't
          // know that, and a cast would be a lie waiting to bite.
          null
        ) : (
          <>
            <AddItemForm
              uid={uid}
              rows={rows}
              onAdded={announce}
              onError={(m) => showToast(m, 'error')}
              onSaved={() => backToList()}
            />

            <button
              type="button"
              onClick={() => setScanning(true)}
              className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-accent/40 bg-accent/5 font-semibold text-accent"
            >
              📸 Scan a shelf
            </button>

            {scanning && (
              <ShelfCapture
                uid={uid}
                rows={rows}
                onClose={() => setScanning(false)}
                // A batch add from a photo is a save like any other: say what happened on
                // the list, not on a page we're about to leave.
                onDone={(m) => backToList(m)}
                onError={(m) => showToast(m, 'error')}
              />
            )}
          </>
        )}
      </div>

      <ToastBar toast={toast} />
    </section>
  );
}
