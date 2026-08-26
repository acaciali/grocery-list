/**
 * ⭐ The review grid. The most important screen in this feature.
 *
 * Vision output is a suggestion, not a fact. Anthropic's own docs warn against using Claude
 * for tasks requiring perfect precision without human oversight, and a wrong pantry row
 * silently corrupts Grocery's I2 ("you already have milk", except you don't) and Recipe's
 * I5. Bad data is worse than no data, so nothing here is ever written without a tap.
 *
 * The three things that make it work:
 *   - High-confidence items start checked; low-confidence start UNCHECKED but still visible,
 *     so accepting a shaky guess is a deliberate act and dismissing one is free.
 *   - Every name is editable in place. Fixing "chiken" beats deleting it and retyping.
 *   - Anything already in the pantry is flagged rather than re-offered.
 */
import type { Category, StorageLocation } from '@grocery/shared';
import type { DetectedItem } from './analyzeShelf';
import { CATEGORIES, CATEGORY_LABEL, HIGH_CONFIDENCE, LOCATIONS, LOCATION_META } from './constants';

export interface Candidate extends DetectedItem {
  /** Stable across edits, unlike `key`, which changes the moment someone fixes the name. */
  id: string;
  checked: boolean;
  /** True when this key is already in the pantry -- flagged, not re-added. */
  alreadyHave: boolean;
}

export default function ReviewGrid({
  candidates,
  location,
  stubbed,
  model,
  saving,
  onChange,
  onLocationChange,
  onScanAnother,
  onSave,
  onCancel,
}: {
  candidates: Candidate[];
  location: StorageLocation;
  stubbed: boolean;
  /** The pinned model that produced these, or null on the canned path. */
  model: string | null;
  saving: boolean;
  onChange: (id: string, patch: Partial<Candidate>) => void;
  onLocationChange: (location: StorageLocation) => void;
  onScanAnother: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const selected = candidates.filter((c) => c.checked);
  const newOnes = candidates.filter((c) => !c.alreadyHave);
  const known = candidates.filter((c) => c.alreadyHave);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <p className="text-sm text-ink-soft">
          Found {candidates.length} item{candidates.length === 1 ? '' : 's'}. Check what's right,
          fix what isn't — nothing is saved until you tap add.
        </p>

        {/* A demo run is already disclosed on the intro screen, in amber, BEFORE a photo is
            spent -- repeating it here only cost a banner's worth of scroll. The live label
            stays: naming what read the photo is what keeps a real result distinguishable
            from a canned one. If the intro banner ever goes, this has to come back. */}
        {!stubbed && (
          <p className="mt-2 text-xs text-ink-soft">
            Read from your photo{model ? ` by ${model}` : ''} — always worth a check.
          </p>
        )}

        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="font-semibold">Putting these in</span>
          <select
            value={location}
            onChange={(e) => onLocationChange(e.target.value as StorageLocation)}
            className="min-h-11 flex-1 rounded-card border border-line bg-surface px-3 outline-none focus:border-accent"
          >
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {LOCATION_META[l].emoji} {LOCATION_META[l].label}
              </option>
            ))}
          </select>
        </label>

        <ul className="mt-2 space-y-1.5">
          {newOnes.map((c) => (
            <CandidateCard key={c.id} candidate={c} onChange={onChange} />
          ))}
        </ul>

        {known.length > 0 && (
          <>
            <p className="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Already in your pantry
            </p>
            <ul className="mt-1 space-y-1.5">
              {known.map((c) => (
                <CandidateCard key={c.id} candidate={c} onChange={onChange} />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Pinned so the primary action stays reachable on a phone with fifteen cards. */}
      <div className="border-t border-line bg-surface px-4 py-3">
        <button
          type="button"
          onClick={onSave}
          disabled={selected.length === 0 || saving}
          className="min-h-12 w-full rounded-card bg-accent font-semibold text-white disabled:opacity-40"
        >
          {saving
            ? 'Adding…'
            : `Add ${selected.length} item${selected.length === 1 ? '' : 's'} to pantry`}
        </button>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onScanAnother}
            className="min-h-11 flex-1 rounded-card border border-line font-semibold text-ink-soft"
          >
            📸 Scan another shelf
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-card border border-line px-4 font-semibold text-ink-soft"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  onChange,
}: {
  candidate: Candidate;
  onChange: (id: string, patch: Partial<Candidate>) => void;
}) {
  const confident = candidate.confidence >= HIGH_CONFIDENCE;

  return (
    <li
      className={`rounded-card border bg-surface p-2.5 shadow-sm transition-colors ${
        candidate.checked ? 'border-accent' : 'border-line'
      } ${candidate.alreadyHave ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={candidate.checked}
          onChange={(e) => onChange(candidate.id, { checked: e.target.checked })}
          aria-label={`Add ${candidate.name}`}
          className="mt-3 size-5 shrink-0 accent-[var(--color-accent)]"
        />
        <div className="min-w-0 flex-1">
          {/* One row, not two. Stacking the category under the name cost ~48px a card,
              which is most of the scrolling on a ten-item shelf. Every control here keeps
              its 44px tap target -- the space comes from the layout, not from shrinking
              anything you have to hit with a thumb. */}
          <div className="flex items-center gap-2">
            <input
              value={candidate.name}
              onChange={(e) => onChange(candidate.id, { name: e.target.value })}
              aria-label="Detected item name"
              className="min-h-11 min-w-0 flex-1 rounded-card border border-line bg-surface px-3 text-base outline-none focus:border-accent"
            />

            <select
              value={candidate.category}
              onChange={(e) => onChange(candidate.id, { category: e.target.value as Category })}
              aria-label="Category"
              className="min-h-11 w-28 shrink-0 rounded-card border border-line bg-surface px-2 text-sm outline-none focus:border-accent"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>

            <span
              title={`${Math.round(candidate.confidence * 100)}% confident`}
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                confident ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn'
              }`}
            >
              {Math.round(candidate.confidence * 100)}%
            </span>
          </div>

          {/* Brand is kept out of `name` on purpose: "Jif" must not end up in the key, or
              this stops matching a recipe's "peanut butter". */}
          {(candidate.brand || candidate.note || candidate.alreadyHave) && (
            <p className="mt-1 text-xs text-ink-soft">
              {candidate.alreadyHave && (
                <span className="font-semibold text-accent">Already have this. </span>
              )}
              {candidate.brand && <span>{candidate.brand}. </span>}
              {candidate.note && <span className="italic">{candidate.note}</span>}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
