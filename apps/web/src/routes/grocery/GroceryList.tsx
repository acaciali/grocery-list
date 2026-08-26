import type { Category } from '@grocery/shared';
import GroceryRow from './GroceryRow';
import type { Row } from './data';

/**
 * Aisle order, not alphabetical -- this is the order you actually walk a store in, and
 * the grouping is only worth anything if it saves you doubling back.
 */
const AISLE_ORDER: Category[] = [
  'produce', 'bakery', 'meat', 'seafood', 'dairy', 'frozen',
  'canned', 'pantry', 'spices', 'beverages', 'other',
];

const AISLE_LABEL: Record<Category, string> = {
  produce: 'Produce', bakery: 'Bakery', meat: 'Meat', seafood: 'Seafood',
  dairy: 'Dairy & Eggs', frozen: 'Frozen', canned: 'Canned', pantry: 'Pantry',
  spices: 'Spices', beverages: 'Beverages', other: 'Other',
};

interface Props {
  items: Row[];
  hasStore: boolean;
  onToggle: (row: Row) => void;
  onDelete: (id: string) => void;
  onOpen: (row: Row) => void;
}

export default function GroceryList({ items, hasStore, onToggle, onDelete, onOpen }: Props) {
  if (items.length === 0) {
    return (
      <p className="rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-soft">
        Nothing on the list. Add the first item.
      </p>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  const rowProps = { hasStore, onToggle, onDelete, onOpen };

  // Grouping only helps once there is enough on the list to walk around a store with,
  // and only for the items you still need.
  if (!hasStore || unchecked.length < 4) {
    return (
      <ul className="space-y-2">
        {[...unchecked, ...checked].map((row) => (
          <GroceryRow key={row.id} row={row} {...rowProps} />
        ))}
      </ul>
    );
  }

  const byAisle = new Map<Category, Row[]>();
  for (const row of unchecked) {
    const aisle = row.category ?? 'other';
    byAisle.set(aisle, [...(byAisle.get(aisle) ?? []), row]);
  }

  return (
    <div className="space-y-5">
      {AISLE_ORDER.filter((a) => byAisle.has(a)).map((aisle) => (
        <section key={aisle}>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-soft">
            {AISLE_LABEL[aisle]}
          </h2>
          <ul className="space-y-2">
            {(byAisle.get(aisle) ?? []).map((row) => (
              <GroceryRow key={row.id} row={row} {...rowProps} />
            ))}
          </ul>
        </section>
      ))}

      {checked.length > 0 && (
        <section>
          {/* Not "in the cart" any more: there is a real store cart now, and one phrase
              cannot mean both "already in my trolley" and "sent to Kroger". */}
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-soft">
            Got these
          </h2>
          <ul className="space-y-2">
            {checked.map((row) => (
              <GroceryRow key={row.id} row={row} {...rowProps} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
