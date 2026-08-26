import { MAX_CART_LINES, type SendLine, type SendLineResult } from './api';
import type { Row } from './data';

/**
 * Deciding what goes in the cart, kept pure and apart from both Firestore and the network.
 *
 * This is the last gate before an irreversible action: Kroger's Public API cannot read a
 * cart back or remove from it, so a line sent by mistake is a line the user has to delete
 * in Kroger's own app. Every rule below is about not sending something we shouldn't.
 */

/** Why a row on the list is not going into this send. */
export type BlockedReason =
  | 'no_product' // never matched to a real store product, so there is no UPC to send
  | 'out_of_stock' // matched, but the store says it has none
  | 'other_store'; // matched against a store we are no longer connected to

/** Reads after both "milk isn't going -- X" and "3 items aren't going (X)". */
export const BLOCKED_LABEL: Record<BlockedReason, string> = {
  no_product: 'no store product yet',
  out_of_stock: 'out of stock here',
  other_store: 'being re-checked',
};

export interface Blocked {
  row: Row;
  reason: BlockedReason;
}

export interface CartPlan {
  /** Ready to send, already capped at MAX_CART_LINES. */
  lines: SendLine[];
  /** The rows behind `lines`, same order, for naming them in the UI. */
  sendable: Row[];
  blocked: Blocked[];
  /** Rows already pushed to this cart. Excluded from the send: a re-send duplicates. */
  alreadySent: Row[];
  /** Sendable rows dropped by the cap. Surfaced, never silent. */
  overflow: number;
}

/**
 * What one row contributes to a send.
 *
 * Checked rows are skipped throughout: checking something off means it is already in the
 * physical basket, and sending it to an online cart would buy it twice.
 */
function classify(row: Row, locationId: string): BlockedReason | 'sendable' | 'sent' | 'skip' {
  if (row.checked) return 'skip';
  const match = row.match;
  if (!match) return 'no_product';
  if (match.status === 'sent') return 'sent';
  if (match.status === 'unavailable') return 'out_of_stock';
  // No UPC means no cart line: Kroger's cart endpoint takes UPC, not productId, and the
  // server rejects a line without one rather than sending something that cannot work.
  if (match.status !== 'matched' || !match.product?.upc) return 'no_product';
  if (match.locationId !== locationId) return 'other_store';
  return 'sendable';
}

export function planSend(items: Row[], locationId: string): CartPlan {
  const sendable: Row[] = [];
  const blocked: Blocked[] = [];
  const alreadySent: Row[] = [];

  for (const row of items) {
    const verdict = classify(row, locationId);
    if (verdict === 'skip') continue;
    if (verdict === 'sendable') sendable.push(row);
    else if (verdict === 'sent') alreadySent.push(row);
    else blocked.push({ row, reason: verdict });
  }

  const capped = sendable.slice(0, MAX_CART_LINES);
  return {
    lines: capped.map((row) => ({
      itemId: row.id,
      upc: row.match?.product?.upc ?? '',
      quantity: row.match?.cartQuantity ?? 1,
    })),
    sendable: capped,
    blocked,
    alreadySent,
    overflow: sendable.length - capped.length,
  };
}

/** What the send is going to cost, over the lines actually being sent. */
export function planTotal(plan: CartPlan): number | null {
  let total = 0;
  let priced = 0;
  for (const row of plan.sendable) {
    const product = row.match?.product;
    const price = product?.promoPrice ?? product?.price;
    if (price == null) continue;
    total += price * (row.match?.cartQuantity ?? 1);
    priced += 1;
  }
  // A total that quietly omits half the lines reads as complete and is simply wrong.
  return priced === plan.sendable.length && priced > 0 ? total : null;
}

/**
 * The outcome, in words. Failures are named individually: "1 didn't go through" without
 * saying which one leaves the user to diff their list against Kroger's app by hand.
 */
export function describeResult(results: SendLineResult[], rows: Row[]): string {
  const nameOf = new Map(rows.map((row) => [row.id, row.name]));
  const failed = results.filter((r) => !r.ok);
  const sent = results.length - failed.length;

  if (failed.length === 0) {
    return `Sent ${sent} item${sent === 1 ? '' : 's'} to your cart.`;
  }
  const names = failed.map((r) => nameOf.get(r.itemId) ?? 'an item').join(', ');
  if (sent === 0) {
    return `Nothing went through: ${names}. Everything is still on your list.`;
  }
  return `Sent ${sent} of ${results.length}. Didn't go through: ${names} — still on your list, so you can try again.`;
}
