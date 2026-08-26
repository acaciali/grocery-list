/**
 * Client half of 📸 /analyzeShelf: downscale, POST, validate.
 *
 * The backend function is real (functions/src/vision.ts -> Claude vision), so this module
 * now talks to it BY DEFAULT: the endpoint is derived from the Firebase project in
 * packages/shared, and no env file is needed to get live results. See .env.example for the
 * overrides (emulator, custom region, forced stub).
 *
 * The canned path still exists, but only when it is asked for explicitly -- it keeps the
 * review grid testable with nothing running and no API key burned. Both paths return the
 * identical shape, so the fallback is a dev convenience, not a lie: the UI labels it via
 * `stubbed`.
 */
import {
  asItemKey,
  firebaseConfig,
  normalizeKey,
  type Category,
  type ShelfCandidate,
} from '@grocery/shared';
import { CATEGORIES } from './constants';

/**
 * Now the shared contract, not a local copy: the vision endpoint returns ShelfCandidate,
 * so both halves of /analyzeShelf are typed by the same declaration and cannot drift.
 * The alias stays so ReviewGrid's `Candidate extends DetectedItem` reads the same.
 */
export type DetectedItem = ShelfCandidate;

export interface AnalyzeShelfResult {
  items: DetectedItem[];
  /** The UI says so out loud rather than implying the AI is live. */
  stubbed: boolean;
  /** Which pinned model produced these, straight from AnalyzeShelfResponse. Null when stubbed. */
  model: string | null;
}

/** Thrown with a message already fit to show a user. */
export class AnalyzeShelfError extends Error {}

/**
 * Claude's standard image tier caps at 1568px on the long edge -- anything larger is
 * downscaled server-side anyway, costing upload time and latency for zero accuracy gain.
 * Raw phone photos are 4-12MB; this step gets them to roughly 200-500KB.
 */
const MAX_EDGE = 1568;

/**
 * Don't overcorrect. Edges under ~200px measurably degrade recognition, so a small source
 * image is left alone rather than being pushed further down.
 */
const MIN_EDGE = 200;

const JPEG_QUALITY = 0.8;

/**
 * The function is configured with timeoutSeconds: 120, so a request still open past that
 * is never coming back. Without this the spinner spins forever on a dropped connection.
 */
const REQUEST_TIMEOUT_MS = 125_000;

/**
 * Draw through a canvas at a capped size. This also quietly solves the HEIC problem: the
 * model accepts JPEG/PNG/GIF/WebP and *not* HEIC, which is exactly what an iPhone shoots.
 * Because the browser decodes to a bitmap and we re-encode as JPEG, the conversion is free.
 */
export async function downscaleToJpeg(file: Blob): Promise<{ base64: string; dataUrl: string }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AnalyzeShelfError(
      "That image couldn't be read. JPEG, PNG, GIF and WebP all work — try another photo.",
    );
  });

  const longEdge = Math.max(bitmap.width, bitmap.height);
  const shortEdge = Math.min(bitmap.width, bitmap.height);

  // Shrink the long edge to the cap, never upscale a small source.
  let scale = Math.min(1, MAX_EDGE / longEdge);
  // ...but not so far that the SHORT edge drops below the point where recognition starts
  // to suffer. A very wide shelf shot -- 4000x500 -- would otherwise come out 1568x196.
  if (shortEdge * scale < MIN_EDGE) scale = Math.min(1, MIN_EDGE / shortEdge);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AnalyzeShelfError('Your browser blocked image processing.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { base64, dataUrl };
}

/** Same canned set as the stub function, for the explicit no-endpoint path. */
const CANNED: readonly Omit<DetectedItem, 'key'>[] = [
  { name: 'black beans', brand: "Bush's", category: 'canned', confidence: 0.94 },
  { name: 'peanut butter', brand: 'Jif', category: 'pantry', confidence: 0.91 },
  { name: 'olive oil', brand: null, category: 'pantry', confidence: 0.88 },
  { name: 'white rice', brand: null, category: 'pantry', confidence: 0.86 },
  { name: 'diced tomatoes', brand: "Hunt's", category: 'canned', confidence: 0.82 },
  { name: 'chicken broth', brand: 'Swanson', category: 'canned', confidence: 0.71 },
  { name: 'honey', brand: null, category: 'pantry', confidence: 0.64 },
  { name: 'pasta', brand: null, category: 'pantry', confidence: 0.41, note: 'partially occluded' },
  { name: 'cinnamon', brand: null, category: 'spices', confidence: 0.33, note: 'label not legible' },
];

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * The response is model output that passed through a function. Validate it rather than
 * trusting it: an unknown category or a missing confidence would otherwise reach the
 * review grid and render as undefined.
 */
function coerce(raw: unknown): DetectedItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.trim() === '') return null;

  const confidence = typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0;

  // The server normalizes, and we trust that key so both paths agree. If it's absent we
  // derive one here rather than dropping an otherwise good detection.
  const key = typeof r.key === 'string' && r.key !== '' ? asItemKey(r.key) : normalizeKey(r.name);

  return {
    key,
    name: r.name.trim(),
    brand: typeof r.brand === 'string' ? r.brand : null,
    category: isCategory(r.category) ? r.category : 'other',
    confidence,
    note: typeof r.note === 'string' ? r.note : null,
  };
}

/** Region the functions are deployed to. onRequest defaults to us-central1. */
const REGION = (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined) ?? 'us-central1';

/**
 * Where to POST, resolved once at module load.
 *
 * The default is the deployed function derived from the same firebaseConfig the rest of
 * the app uses, so "it shows demo data" can no longer be caused by a missing env file --
 * only by the function not being deployed, which the 404 branch below names outright.
 *
 * Returns null only when the canned path is explicitly requested.
 */
function resolveEndpoint(): string | null {
  // 1. Explicit URL wins: any deploy, any emulator, any tunnel.
  const explicit = (import.meta.env.VITE_ANALYZE_SHELF_URL as string | undefined)?.trim();
  if (explicit) return explicit;

  // 2. Opt in to canned data on purpose (offline demo, UI work, no API key).
  if (import.meta.env.VITE_SHELF_STUB === 'true') return null;

  // 3. Local Firebase emulator, addressed the way it names its own functions.
  const project = firebaseConfig.projectId;
  if (import.meta.env.VITE_FUNCTIONS_EMULATOR === 'true') {
    const port = (import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT as string | undefined) ?? '5001';
    return `http://127.0.0.1:${port}/${project}/${REGION}/analyzeShelf`;
  }

  // 4. Default: the deployed function.
  return `https://${REGION}-${project}.cloudfunctions.net/analyzeShelf`;
}

const ENDPOINT = resolveEndpoint();

/** True when a photo will actually reach the model. Lets the UI promise the right thing. */
export const isLive = ENDPOINT !== null;

/**
 * vision.ts answers every failure with `{ error }` already worded for a person -- image
 * too large, service busy, model unreadable. Prefer that over a generic client guess, and
 * fall back to one when the body is empty or isn't ours.
 */
async function serverError(res: Response, fallback: string): Promise<AnalyzeShelfError> {
  const body: unknown = await res.json().catch(() => null);
  const message =
    typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? ((body as { error: string }).error)
      : fallback;
  return new AnalyzeShelfError(message);
}

export async function analyzeShelf(file: Blob): Promise<AnalyzeShelfResult> {
  const { base64 } = await downscaleToJpeg(file);

  if (ENDPOINT === null) {
    // Canned data asked for by name: same shape, same latency feel, no network.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      items: CANNED.map((c) => ({ ...c, key: normalizeKey(c.name) })),
      stubbed: true,
      model: null,
    };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mediaType: 'image/jpeg' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // A timeout and a dead connection are different problems with different fixes, so
    // don't collapse them into one message.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new AnalyzeShelfError(
        'The shelf scanner took too long to answer. Try again, or add the items by hand.',
      );
    }
    throw new AnalyzeShelfError("Couldn't reach the shelf scanner. Check your connection.");
  }

  if (res.status === 404) {
    // Overwhelmingly the reason a fresh checkout can't scan: the function isn't up yet.
    throw new AnalyzeShelfError(
      "The shelf scanner isn't deployed yet. Deploy the analyzeShelf function, or point VITE_ANALYZE_SHELF_URL at a running emulator.",
    );
  }
  if (!res.ok) {
    throw await serverError(
      res,
      res.status === 429
        ? 'The shelf scanner is busy right now. Try again in a moment.'
        : 'The shelf scanner had a problem. You can still add items by hand.',
    );
  }

  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { items?: unknown }).items)) {
    throw new AnalyzeShelfError('The shelf scanner sent back something unreadable.');
  }

  const raw = body as { items: unknown[]; model?: unknown };
  return {
    items: raw.items.map(coerce).filter((i): i is DetectedItem => i !== null),
    // A real response is never stubbed. The old code read this off the body, which the
    // real endpoint never sends -- so the flag now follows the path actually taken.
    stubbed: false,
    model: typeof raw.model === 'string' ? raw.model : null,
  };
}
