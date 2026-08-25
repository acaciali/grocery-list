/** Empty-state shell for routes whose teams haven't landed yet. */
export default function PlaceholderPage({
  title,
  emoji,
  blurb,
}: {
  title: string;
  emoji: string;
  blurb: string;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
      <p className="text-4xl" aria-hidden="true">
        {emoji}
      </p>
      <h2 className="mt-3 text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm text-ink-soft">{blurb}</p>
    </section>
  );
}
