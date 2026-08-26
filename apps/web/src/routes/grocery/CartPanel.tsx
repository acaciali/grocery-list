import { useMemo, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { Modality } from './api';
import { BLOCKED_LABEL, planSend, planTotal } from './cartPlan';
import type { Row } from './data';
import { useCartSend } from './useCartSend';
import { useKrogerLink } from './useKrogerLink';

/**
 * Sending the list to the store's cart.
 *
 * Two things shape this whole component:
 *
 *  1. **The cart is write-only.** Kroger's Public API can add to a cart but never read it
 *     back or remove from it. So this never claims to know what is in the cart -- it
 *     reports what we sent and when, and says where the truth lives.
 *  2. **A send cannot be undone here.** That makes "what exactly is about to happen" the
 *     most important thing on screen: the count, the total, and what is being left behind.
 */

const MODALITIES: { value: Modality; label: string }[] = [
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'DELIVERY', label: 'Delivery' },
];

const MODALITY_KEY = 'grocery:cartModality';
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** localStorage throws outright in some privacy modes, and a fulfilment default is not
 * worth taking the page down for. */
function storedModality(): Modality {
  try {
    return localStorage.getItem(MODALITY_KEY) === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
  } catch {
    return 'PICKUP';
  }
}

function rememberModality(value: Modality): void {
  try {
    localStorage.setItem(MODALITY_KEY, value);
  } catch {
    /* Not worth telling anyone about; the choice still applies to this send. */
  }
}

/** serverTimestamp() reads back null on the local echo, so a fresh send has no time yet. */
function millisOf(value: Timestamp | null | undefined): number | null {
  if (value == null || typeof value.toMillis !== 'function') return null;
  return value.toMillis();
}

function lastSendTime(items: Row[]): string | null {
  const times = items
    .filter((row) => row.match?.status === 'sent')
    .map((row) => millisOf(row.match?.sentAt))
    .filter((ms): ms is number => ms !== null);
  return times.length === 0 ? null : TIME_FORMAT.format(new Date(Math.max(...times)));
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** "milk, butter and 3 more" -- naming a couple of items beats a bare count. */
function nameSome(rows: Row[], limit = 2): string {
  const names = rows.slice(0, limit).map((row) => row.name);
  const rest = rows.length - names.length;
  if (rest > 0) names.push(`${rest} more`);
  const last = names.pop() ?? '';
  return names.length === 0 ? last : `${names.join(', ')} and ${last}`;
}

interface Props {
  items: Row[];
  locationId: string | null;
  storeName: string | null;
  uid: string | null;
}

export default function CartPanel({ items, locationId, storeName, uid }: Props) {
  const [modality, setModality] = useState<Modality>(storedModality);
  const link = useKrogerLink(uid);
  const { sending, outcome, clearOutcome, send } = useCartSend({
    uid,
    locationId,
    modality,
    onUnlinked: link.markUnlinked,
  });

  const plan = useMemo(
    () => (locationId === null ? null : planSend(items, locationId)),
    [items, locationId],
  );

  // Without a store there is no cart to send to, and the store button above already
  // offers the fix. A second dead control here would just be noise.
  if (locationId === null || plan === null) return null;

  const total = planTotal(plan);
  const count = plan.lines.length;
  const sentTime = lastSendTime(items);
  const blockedGroups = new Map<string, Row[]>();
  for (const { row, reason } of plan.blocked) {
    blockedGroups.set(BLOCKED_LABEL[reason], [
      ...(blockedGroups.get(BLOCKED_LABEL[reason]) ?? []),
      row,
    ]);
  }

  const needsLink = link.state === 'unlinked';
  // No uid means no Kroger tokens to send with -- the server keys them by user. Without
  // this the button would be pressable and quietly do nothing.
  const signedOut = uid === null;
  const canSend = count > 0 && !needsLink && !signedOut;

  return (
    <section
      aria-labelledby="cart-panel-title"
      className="mt-4 rounded-card border border-line bg-surface p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="cart-panel-title" className="text-xs font-bold uppercase tracking-wide text-ink-soft">
          Send to {storeName ?? 'your store'}
        </h2>
        <div role="group" aria-label="How you're getting it" className="flex gap-1">
          {MODALITIES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={modality === value}
              onClick={() => {
                setModality(value);
                rememberModality(value);
              }}
              className={`rounded-card border px-2.5 py-1 text-xs font-semibold transition-colors ${
                modality === value
                  ? 'border-accent bg-accent text-white'
                  : 'border-line text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {signedOut ? (
        <p className="mt-2 text-sm text-warn">
          You&apos;re signed out, so there&apos;s no cart to send to. Your list still works —
          reload to try signing in again.
        </p>
      ) : needsLink ? (
        <>
          <p className="mt-2 text-sm text-ink-soft">
            Prices come from the store, but putting things in a cart needs your permission
            on Kroger&apos;s own site.
          </p>
          <button
            type="button"
            onClick={() => void link.link()}
            disabled={link.busy}
            className="mt-2 min-h-12 w-full rounded-card bg-accent font-semibold text-white disabled:opacity-50"
          >
            {link.busy ? 'Opening Kroger…' : 'Link your Kroger account'}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void send(plan)}
            disabled={!canSend || sending}
            className="mt-2 min-h-12 w-full rounded-card bg-accent font-semibold text-white disabled:opacity-50"
          >
            {sending
              ? 'Sending…'
              : count === 0
                ? 'Nothing to send yet'
                : `Send ${count} item${count === 1 ? '' : 's'}${total === null ? '' : ` · ${money(total)}`}`}
          </button>
          {count > 0 && (
            <p className="mt-1.5 text-center text-xs text-ink-soft">
              Adds to your Kroger cart. It can&apos;t be undone from here — remove things in
              the Kroger app.
            </p>
          )}
        </>
      )}

      {/* Everything the send is NOT covering, because the button's count is otherwise
          easy to read as "the whole list". */}
      <div aria-live="polite" className="mt-2 space-y-1 text-xs text-ink-soft">
        {outcome && (
          <p
            className={`text-sm font-medium ${outcome.kind === 'ok' ? 'text-ink' : 'text-warn'}`}
          >
            {outcome.message}{' '}
            <button
              type="button"
              onClick={clearOutcome}
              className="font-semibold underline decoration-dotted"
            >
              Dismiss
            </button>
          </p>
        )}

        {link.notice && (
          <p
            className={`text-sm font-medium ${
              link.notice.kind === 'linked' ? 'text-ink' : 'text-warn'
            }`}
          >
            {link.notice.message}{' '}
            <button
              type="button"
              onClick={link.dismissNotice}
              className="font-semibold underline decoration-dotted"
            >
              Dismiss
            </button>
          </p>
        )}

        {[...blockedGroups].map(([label, rows]) => (
          <p key={label}>
            {rows.length === 1
              ? `${nameSome(rows)} isn't going — ${label}`
              : `${rows.length} items aren't going (${label}): ${nameSome(rows)}`}
          </p>
        ))}

        {plan.overflow > 0 && (
          <p className="font-semibold text-warn">
            {plan.overflow} more won&apos;t fit in one send. Send these, then send again.
          </p>
        )}

        {plan.alreadySent.length > 0 && (
          <p>
            {plan.alreadySent.length} already in the cart
            {sentTime === null ? '' : `, last sent at ${sentTime}`}. Kroger can&apos;t tell us
            what&apos;s in there, so check the Kroger app to be sure.
          </p>
        )}
      </div>
    </section>
  );
}
