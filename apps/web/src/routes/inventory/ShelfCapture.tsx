/**
 * 📸 Shelf capture: tips → photo → analyze → review → batch add.
 *
 * Two inputs, deliberately. People photograph the pantry standing up and sort it out later
 * on the couch, so library upload is a first-class path and not a fallback -- it is also
 * the only way to demo reliably when venue wifi or camera permissions misbehave.
 */
import { useEffect, useRef, useState } from 'react';
import { normalizeKey, type InventoryRow, type StorageLocation } from '@grocery/shared';
import { pantry } from './pantryStore';
import { AnalyzeShelfError, analyzeShelf, isLive } from './analyzeShelf';
import ReviewGrid, { type Candidate } from './ReviewGrid';
import { HIGH_CONFIDENCE } from './constants';

type Stage = 'intro' | 'camera' | 'analyzing' | 'review' | 'error';

export default function ShelfCapture({
  uid,
  rows,
  onClose,
  onError,
  onDone,
}: {
  uid: string;
  rows: InventoryRow[];
  onClose: () => void;
  onError: (msg: string) => void;
  onDone: (msg: string) => void;
}) {
  const [stage, setStage] = useState<Stage>('intro');
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [location, setLocation] = useState<StorageLocation>('pantry');
  const [stubbed, setStubbed] = useState(false);
  // Which pinned model read the shelf, so the review screen can say so rather than
  // leaving the user to guess whether anything real happened.
  const [model, setModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Counter, not Math.random, so ids stay stable and collision-free across shelves.
  const nextId = useRef(0);

  /**
   * ⚠️ The camera light stays on until every track is stopped. Closing the sheet without
   * this leaves it burning, which reads to a user as "this app is watching me".
   */
  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }
  useEffect(() => stopCamera, []);

  async function startCamera() {
    // getUserMedia is only defined in a secure context. On a LAN IP like 192.168.1.5:5173
    // it is missing entirely rather than failing -- which is exactly the hour-costing
    // silent failure, so name it instead of showing a generic error.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage(
        'The camera only works on localhost or https. Open the app at localhost:5173 — or pick a photo from your library, which works anywhere.',
      );
      setStage('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera is the one pointed at the shelf.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setStage('camera');
      // The <video> only exists after the stage renders, so attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (err) {
      console.error(err);
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setMessage(
        denied
          ? "Camera access is blocked. You can allow it in your browser's site settings, pick a photo from your library, or just type items in by hand."
          : "Couldn't start the camera. Try picking a photo from your library instead.",
      );
      setStage('error');
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    stopCamera();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    // Full-quality here; analyzeShelf does the real 1568px downscale in one place.
    if (blob) await runAnalysis(blob);
  }

  async function runAnalysis(file: Blob) {
    setStage('analyzing');
    try {
      const result = await analyzeShelf(file);
      setStubbed(result.stubbed);
      setModel(result.model);

      if (result.items.length === 0) {
        setMessage(
          "Nothing recognizable on that shelf. One shelf at a time, straight on, labels facing out and good light all help — or add the items by hand.",
        );
        setStage('error');
        return;
      }

      const existingKeys = new Set(rows.map((r) => r.key));
      setCandidates((prev) => {
        // "Scan another shelf" keeps the running batch, so a whole pantry is one session.
        // De-dupe against what's already in the batch: two shelves both showing olive oil
        // should not produce two cards.
        const seen = new Set(prev.map((c) => c.key));
        const added = result.items
          .filter((item) => !seen.has(item.key))
          .map<Candidate>((item) => {
            const alreadyHave = existingKeys.has(item.key);
            return {
              ...item,
              id: `c${nextId.current++}`,
              alreadyHave,
              // Pre-check confident finds. Low-confidence and already-owned start off,
              // so adding either is a deliberate tap.
              checked: item.confidence >= HIGH_CONFIDENCE && !alreadyHave,
            };
          });
        return [...prev, ...added];
      });
      setStage('review');
    } catch (err) {
      console.error(err);
      setMessage(
        err instanceof AnalyzeShelfError
          ? err.message
          : "Something went wrong reading that photo. You can still add items by hand.",
      );
      setStage('error');
    }
  }

  function patchCandidate(id: string, patch: Partial<Candidate>) {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // An edited name is a different item, so its key -- and therefore whether we
        // already own it -- has to be recomputed as they type.
        if (patch.name !== undefined) {
          try {
            next.key = normalizeKey(patch.name);
            next.alreadyHave = rows.some((r) => r.key === next.key);
          } catch {
            // Mid-edit the field can be empty or all filler. Keep the old key; the save
            // button re-validates anyway.
          }
        }
        return next;
      }),
    );
  }

  async function saveBatch() {
    const chosen = candidates.filter((c) => c.checked);
    if (chosen.length === 0) return;

    setSaving(true);
    try {
      // One batch write, not fifteen round-trips. upsertMany de-dupes by key and is
      // idempotent, so re-running the same shelf changes nothing.
      await pantry.upsertMany(
        uid,
        chosen.map((c) => ({
          name: c.name.trim(),
          key: c.key,
          category: c.category,
          location,
          addedVia: 'photo' as const,
          // Kept so the list can keep flagging a shaky guess after it lands.
          confidence: c.confidence,
        })),
      );
      onDone(`Added ${chosen.length} item${chosen.length === 1 ? '' : 's'} from the photo`);
      onClose();
    } catch (err) {
      console.error(err);
      onError("Couldn't add those items.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-bold">📸 Scan a shelf</h2>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="min-h-11 px-2 text-sm font-semibold text-ink-soft"
        >
          Close
        </button>
      </header>

      {/* One hidden input serves both entry points. `capture` is intentionally absent so
          phones offer the library as well as the camera. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset first, so picking the same file twice still fires a change event.
          e.target.value = '';
          if (file) void runAnalysis(file);
        }}
      />

      {stage === 'intro' && (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="rounded-card border border-line bg-surface p-4">
            <h3 className="text-sm font-bold">For the best results 💡</h3>
            {/* Framing guidance moves accuracy more than prompt wording does, which is why
                this is inline before the first capture rather than buried in a help page. */}
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li>• One shelf at a time</li>
              <li>• Straight on, not at an angle</li>
              <li>• Labels facing out</li>
              <li>• Good light, no glare</li>
            </ul>
            <p className="mt-3 text-xs text-ink-soft">
              Packaged goods with readable labels work well. Loose produce, opaque tubs and
              deep shelves are hit and miss — you'll confirm everything on the next screen.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 min-h-12 w-full rounded-card bg-accent font-semibold text-white"
          >
            Choose a photo
          </button>
          <button
            type="button"
            onClick={() => void startCamera()}
            className="mt-2 min-h-12 w-full rounded-card border border-line bg-surface font-semibold text-ink"
          >
            Use the camera
          </button>
        </div>
      )}

      {stage === 'camera' && (
        <div className="flex flex-1 flex-col">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="flex-1 bg-black object-cover"
          />
          <div className="px-4 py-3">
            <button
              type="button"
              onClick={() => void capture()}
              className="min-h-14 w-full rounded-card bg-accent text-lg font-semibold text-white"
            >
              Capture
            </button>
          </div>
        </div>
      )}

      {stage === 'analyzing' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="size-10 animate-spin rounded-full border-4 border-line border-t-accent" />
          <p className="font-semibold">Reading the shelf…</p>
          <p className="text-sm text-ink-soft">
            This takes a few seconds. You'll get to check everything before anything is saved.
          </p>
        </div>
      )}

      {stage === 'review' && (
        <ReviewGrid
          candidates={candidates}
          location={location}
          stubbed={stubbed}
          model={model}
          saving={saving}
          onChange={patchCandidate}
          onLocationChange={setLocation}
          onScanAnother={() => setStage('intro')}
          onSave={() => void saveBatch()}
          onCancel={() => {
            stopCamera();
            onClose();
          }}
        />
      )}

      {stage === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-3xl" aria-hidden="true">
            🤔
          </p>
          <p className="text-sm text-ink-soft">{message}</p>
          {/* Every dead end offers a way forward, including the manual form. */}
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-12 w-full rounded-card bg-accent font-semibold text-white"
            >
              Choose a photo
            </button>
            <button
              type="button"
              onClick={() => setStage(candidates.length > 0 ? 'review' : 'intro')}
              className="min-h-12 w-full rounded-card border border-line bg-surface font-semibold text-ink-soft"
            >
              {candidates.length > 0 ? 'Back to review' : 'Back'}
            </button>
            <button
              type="button"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="min-h-12 w-full rounded-card border border-line bg-surface font-semibold text-ink-soft"
            >
              Add items by hand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
