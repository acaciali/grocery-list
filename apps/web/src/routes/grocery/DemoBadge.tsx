/**
 * Marks fixture data as fixture data.
 *
 * The free-plan store mode answers every search from a fixture table (see `localStore`),
 * which means real-looking product names and real-looking prices for groceries someone is
 * actually going to go buy. Unlabelled, that is misinformation rather than a demo, so this
 * badge is not decoration -- it is the honesty requirement for that mode, and the same rule
 * the shelf scanner follows for its stub results.
 *
 * Rendered inside a <button> in one place, so it must stay non-interactive.
 */
export default function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`ml-1.5 inline-block shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 align-middle text-[0.65rem] font-bold uppercase tracking-wide text-warn ${className}`}
    >
      Demo
      <span className="sr-only"> store: sample products and prices, not real ones</span>
    </span>
  );
}
