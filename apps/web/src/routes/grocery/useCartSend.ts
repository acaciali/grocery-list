import { useCallback, useState } from 'react';
import { ApiError, sendToCart, type Modality } from './api';
import { describeResult, type CartPlan } from './cartPlan';
import { markSent } from './data';

/**
 * One press of "send to cart", end to end: push the lines, record what landed, say what
 * happened.
 *
 * Deliberately not retried automatically. Kroger's Public API cannot read a cart back, so
 * a request that times out after the store already accepted it is indistinguishable from
 * one that never arrived -- and an automatic retry would double the order. Retrying is the
 * user's call, and it is safe because only successful lines are marked 'sent'.
 */

export interface SendOutcome {
  kind: 'ok' | 'partial' | 'error';
  message: string;
}

export interface CartSend {
  sending: boolean;
  outcome: SendOutcome | null;
  clearOutcome: () => void;
  send: (plan: CartPlan) => Promise<void>;
}

export function useCartSend(opts: {
  uid: string | null;
  locationId: string | null;
  modality: Modality;
  /** Called when the store rejects our authorization, so the UI can ask for a re-link. */
  onUnlinked: () => void;
}): CartSend {
  const { uid, locationId, modality, onUnlinked } = opts;
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);

  const send = useCallback(
    async (plan: CartPlan) => {
      if (uid === null || locationId === null || plan.lines.length === 0) return;
      setSending(true);
      setOutcome(null);
      try {
        const { results } = await sendToCart({ uid, locationId, modality, lines: plan.lines });
        const failed = results.filter((r) => !r.ok).length;
        // Record first, describe second: if the mark-sent write fails the send still
        // happened, and the user needs to be told that before anything else.
        try {
          await markSent(results);
        } catch (err) {
          console.error('markSent failed after a successful send', err);
          setOutcome({
            kind: 'partial',
            message:
              "Your cart was sent, but we couldn't record it on this list. Check the " +
              'Kroger app before sending again — sending twice adds the items twice.',
          });
          return;
        }
        setOutcome({
          kind: failed === 0 ? 'ok' : 'partial',
          message: describeResult(results, plan.sendable),
        });
      } catch (err) {
        console.error('addToCart failed', err);
        if (err instanceof ApiError && err.status === 401) {
          onUnlinked();
          setOutcome({
            kind: 'error',
            message: 'Your Kroger link has expired. Link again to send this list.',
          });
          return;
        }
        setOutcome({
          kind: 'error',
          message:
            err instanceof ApiError && err.status === 400
              ? `Kroger rejected the list: ${err.message}`
              : "Couldn't reach Kroger. Nothing was sent, and your list is unchanged.",
        });
      } finally {
        setSending(false);
      }
    },
    [uid, locationId, modality, onUnlinked],
  );

  return { sending, outcome, clearOutcome: () => setOutcome(null), send };
}
