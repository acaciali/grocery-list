import MatchChip from './MatchChip';
import type { Row } from './data';

const QUANTITY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function amount(row: Row): string | null {
  if (row.quantity == null) return null;
  return [QUANTITY_FORMAT.format(row.quantity), row.unit].filter(Boolean).join(' ');
}

export default function GroceryRow({
  row,
  onToggle,
  onDelete,
  onOpenMatch,
}: {
  row: Row;
  onToggle: (row: Row) => void;
  onDelete: (id: string) => void;
  onOpenMatch: (row: Row) => void;
}) {
  const qty = amount(row);

  return (
    <li
      className={`flex items-center rounded-card border border-line bg-surface shadow-sm ${
        row.checked ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(row)}
        aria-label={`${row.checked ? 'Uncheck' : 'Check'} ${row.name}`}
        className="flex min-h-12 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left"
      >
        <span
          aria-hidden="true"
          className={`grid size-5 shrink-0 place-items-center rounded-full border text-xs text-white ${
            row.checked ? 'border-accent bg-accent' : 'border-ink-soft'
          }`}
        >
          {row.checked ? '✓' : ''}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${row.checked ? 'line-through' : ''}`}>
            {qty && <span className="mr-1.5 font-semibold tabular-nums">{qty}</span>}
            {row.name}
          </span>
          {row.source === 'recipe' && (
            <span className="mt-0.5 block text-xs text-ink-soft">From a recipe</span>
          )}
        </span>
      </button>

      <span className="shrink-0 pr-1">
        <MatchChip match={row.match} onOpen={() => onOpenMatch(row)} />
      </span>

      <button
        type="button"
        onClick={() => onDelete(row.id)}
        aria-label={`Delete ${row.name}`}
        className="min-h-12 shrink-0 px-3 text-lg text-ink-soft hover:text-warn"
      >
        ×
      </button>
    </li>
  );
}
