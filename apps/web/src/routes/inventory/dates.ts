/**
 * Expiry dates, converted between the three shapes they take: the contract's Timestamp,
 * the `<input type="date">` string, and human display text.
 *
 * ⚠️ All of this is deliberately LOCAL-time. `new Date('2026-03-04')` parses as UTC
 * midnight, which in any negative-offset timezone renders as the 3rd -- a date picked as
 * the 4th silently showing up as the 3rd is the kind of bug nobody reports and everybody
 * distrusts. Every conversion here goes through local Y/M/D parts instead.
 */
import { Timestamp } from 'firebase/firestore';

/** Timestamp -> "YYYY-MM-DD" for an <input type="date"> value. */
export function toDateInputValue(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const d = ts.toDate();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** "YYYY-MM-DD" -> Timestamp at local midnight. Empty string means "no date". */
export function fromDateInputValue(value: string): Timestamp | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Timestamp.fromDate(new Date(y, m - 1, d));
}

export interface ExpiryNote {
  label: string;
  /** Expired, or close enough that the user should act on it. */
  urgent: boolean;
}

/**
 * Human text for an expiry date. Compared at local midnight so "today" means the calendar
 * day, not a rolling 24 hours -- milk expiring at 9am today is still "today" at 5pm.
 */
export function describeExpiry(ts: Timestamp | null | undefined): ExpiryNote | null {
  if (!ts) return null;

  const target = ts.toDate();
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const days = Math.round(
    (startOfTarget.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (days < 0) return { label: days === -1 ? 'Expired yesterday' : 'Expired', urgent: true };
  if (days === 0) return { label: 'Expires today', urgent: true };
  if (days === 1) return { label: 'Expires tomorrow', urgent: true };
  if (days <= 3) return { label: `Expires in ${days} days`, urgent: true };

  return {
    label: `Expires ${startOfTarget.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })}`,
    urgent: false,
  };
}
