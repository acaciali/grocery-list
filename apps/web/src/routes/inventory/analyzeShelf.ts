/**
 * Client half of 📸 /analyzeShelf: downscale, POST, validate.
 *
 * The backend function is currently a stub (functions/src/vision.ts). This module talks to
 * it if VITE_ANALYZE_SHELF_URL is set, and otherwise falls back to the same canned data
 * in-process so the review grid is testable with nothing running. Both paths return the
 * identical shape, so the day the real function lands the only change is the env var.
 */
import { asItemKey, normalizeKey, type Category, type ItemKey } from '@grocery/shared';
import { CATEGORIES } from './constants';

/**
 * Mirrors functions/src/vision.ts. Duplicated rather than imported because `functions` is
 * a separate workspace the web app does not depend on -- if this pair ever drifts, promote
 * it into packages/shared instead of patching one side.
 */
export interface DetectedItem {
  key: ItemKey;
  name: string;
  brand?: string | null;
  category: Category;
  confidence: number;
  note?: string | null;
}

export interface AnalyzeShelfResult {
  items: DetectedItem[];
  /** The UI says so out loud rather than implying the AI is live. */
  stubbed: boolean;
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

/** Same canned set as the stub function, for when no endpoint is configured. */
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

const ENDPOINT = import.meta.env.VITE_ANALYZE_SHELF_URL as string | undefined;

export async function analyzeShelf(file: Blob): Promise<AnalyzeShelfResult> {
  const { base64 } = await downscaleToJpeg(file);

  if (!ENDPOINT) {
    // No endpoint configured: same shape, same latency feel, no network.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      items: CANNED.map((c) => ({ ...c, key: normalizeKey(c.name) })),
      stubbed: true,
    };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mediaType: 'image/jpeg' }),
    });
  } catch {
    throw new AnalyzeShelfError("Couldn't reach the shelf scanner. Check your connection.");
  }

  if (res.status === 429) {
    throw new AnalyzeShelfError('The shelf scanner is busy right now. Try again in a moment.');
  }
  if (!res.ok) {
    throw new AnalyzeShelfError("The shelf scanner had a problem. You can still add items by hand.");
  }

  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { items?: unknown }).items)) {
    throw new AnalyzeShelfError("The shelf scanner sent back something unreadable.");
  }

  const raw = body as { items: unknown[]; stubbed?: unknown };
  return {
    items: raw.items.map(coerce).filter((i): i is DetectedItem => i !== null),
    stubbed: raw.stubbed === true,
  };
}
