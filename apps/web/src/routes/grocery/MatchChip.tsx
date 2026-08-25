import type { MatchStatus, StoreMatch } from '@grocery/shared';

const money = (n: number) => `$${n.toFixed(2)}`;

interface Display {
  label: string;
  tone: 'quiet' | 'good' | 'warn' | 'bad';
  /** Whether tapping it should open the picker. */
  actionable: boolean;
}

/**
 * Every status gets its own words. The distinctions carry real information:
 * "we found nothing" and "we found it but the store is out" lead to different actions,
 * and collapsing them into a single "unavailable" would hide that from the user.
 */
function describe(match: StoreMatch): Display {
  const status: MatchStatus = match.status;
  switch (status) {
    case 'resolving':
      return { label: 'Checking…', tone: 'quiet', actionable: false };
    case 'matched': {
      const p = match.product;
      const price = p?.promoPrice ?? p?.price;
      return {
        label: [p?.size, price != null ? money(price) : null].filter(Boolean).join(' · ') || 'Matched',
        tone: 'good',
        actionable: true,
      };
    }
    case 'ambiguous':
      return {
        label: `${match.candidates?.length ?? 0} options`,
        tone: 'warn',
        actionable: true,
      };
    case 'unavailable':
      return { label: 'Out of stock', tone: 'bad', actionable: true };
    case 'no_match':
      return { label: 'Not found', tone: 'warn', actionable: true };
    case 'not_sold':
      return { label: 'Not sold here', tone: 'quiet', actionable: true };
    case 'sent':
      return { label: 'Sent to cart', tone: 'good', actionable: false };
    case 'unresolved':
      return { label: '', tone: 'quiet', actionable: false };
  }
}

const TONE: Record<Display['tone'], string> = {
  quiet: 'text-ink-soft',
  good: 'text-ink-soft',
  warn: 'text-warn',
  bad: 'text-warn font-semibold',
};

export default function MatchChip({
  match,
  onOpen,
}: {
  match: StoreMatch | null | undefined;
  onOpen: () => void;
}) {
  if (!match || match.status === 'unresolved') return null;
  const { label, tone, actionable } = describe(match);
  if (!label) return null;

  const content = (
    <>
      {match.status === 'matched' && <span aria-hidden="true">✓ </span>}
      {match.chosenBy === 'memory' && match.status === 'matched' && (
        <span aria-hidden="true" title="Chosen because you picked it last time">
          ★{' '}
        </span>
      )}
      {label}
    </>
  );

  if (!actionable) {
    return <span className={`text-xs tabular-nums ${TONE[tone]}`}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rounded px-1.5 py-0.5 text-xs tabular-nums underline decoration-dotted underline-offset-2 hover:bg-bg ${TONE[tone]}`}
    >
      {content}
    </button>
  );
}
