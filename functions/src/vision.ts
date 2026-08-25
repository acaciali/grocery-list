/**
 * 📸 POST /analyzeShelf -- shelf photo -> candidate items.
 *
 * ⚠️ THIS IS A STUB. It returns canned detections and never calls Anthropic.
 *
 * It exists so the frontend review grid can be built, demoed and reviewed today against
 * the exact request and response shapes the real implementation will use. When the real
 * one lands, the contract below does not change -- only the middle of the handler does.
 *
 * What the real implementation still owes (see .claude/inventory.md):
 *   - Anthropic API key via functions config -- THE reason this is a function and not
 *     browser code. An API key in client JS is a public API key.
 *   - Send the image as an `image` content block, base64 source.
 *   - Prompt for a strict JSON array, no prose and no markdown fences. Only food items;
 *     ignore shelves, decor, hands, pets. Generic `name` for matching with `brand`
 *     separate. Skip anything too occluded to identify rather than guessing.
 *   - Validate the JSON and retry ONCE on a parse failure.
 *   - Pin an explicit model string from docs.claude.com/en/docs/about-claude/models.
 *   - Friendly handling for rate limits and timeouts.
 *
 * ⭐ The one thing the stub does faithfully: every name it returns has already been run
 * through normalizeKey(). That is what makes the photo path produce the same key as manual
 * entry and recipe import, and it is why a photographed pantry feeds Grocery's I2 and
 * Recipe's I5 for free. The real version must keep doing this server-side.
 */
import { onRequest } from 'firebase-functions/v2/https';

/** Exactly what the client posts. Downscaled client-side; see the canvas step in the UI. */
export interface AnalyzeShelfRequest {
  /** Base64, no data: URL prefix. */
  image: string;
  /** JPEG/PNG/GIF/WebP only. Notably NOT HEIC, which is what iPhones shoot. */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/** One candidate. `confidence` drives the review UI, so it is required, not optional. */
export interface DetectedItem {
  /** Already normalized server-side. The client must not re-derive it. */
  key: string;
  /** Generic display name, for matching. */
  name: string;
  /** Only when the label is legible. Never folded into `name`. */
  brand?: string | null;
  category: string;
  /** 0-1. */
  confidence: number;
  /** e.g. "partially occluded" -- shown on low-confidence cards. */
  note?: string | null;
}

export interface AnalyzeShelfResponse {
  items: DetectedItem[];
  /** True while this is the stub, so the UI can say so out loud instead of implying magic. */
  stubbed: boolean;
}

export interface AnalyzeShelfError {
  error: { code: 'bad_request' | 'parse_failed' | 'rate_limited' | 'upstream'; message: string };
}

/**
 * Canned detections. Deliberately spans the confidence range -- packaged goods with legible
 * labels score high, the occluded and unlabelled score low -- because the review grid's
 * whole job is treating those two groups differently. A stub that returned nine 0.95s
 * would let a broken review UI look finished.
 */
const CANNED: DetectedItem[] = [
  { key: 'black-bean', name: 'black beans', brand: "Bush's", category: 'canned', confidence: 0.94 },
  { key: 'peanut-butter', name: 'peanut butter', brand: 'Jif', category: 'pantry', confidence: 0.91 },
  { key: 'olive-oil', name: 'olive oil', brand: null, category: 'pantry', confidence: 0.88 },
  { key: 'white-rice', name: 'white rice', brand: null, category: 'pantry', confidence: 0.86 },
  // 'diced' is a descriptor, so normalizeKey() strips it: the key is 'tomato', not
  // 'diced-tomato'. Verified against the real function rather than eyeballed.
  { key: 'tomato', name: 'diced tomatoes', brand: "Hunt's", category: 'canned', confidence: 0.82 },
  { key: 'chicken-broth', name: 'chicken broth', brand: 'Swanson', category: 'canned', confidence: 0.71 },
  { key: 'honey', name: 'honey', brand: null, category: 'pantry', confidence: 0.64 },
  {
    key: 'pasta',
    name: 'pasta',
    brand: null,
    category: 'pantry',
    confidence: 0.41,
    note: 'partially occluded, shape unclear',
  },
  {
    key: 'cinnamon',
    name: 'cinnamon',
    brand: null,
    category: 'spices',
    confidence: 0.33,
    note: 'label not legible at this angle',
  },
];

export const analyzeShelf = onRequest({ cors: true, timeoutSeconds: 60 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'bad_request', message: 'POST only.' } });
    return;
  }

  const body = req.body as Partial<AnalyzeShelfRequest> | undefined;
  if (!body || typeof body.image !== 'string' || body.image.length === 0) {
    res
      .status(400)
      .json({ error: { code: 'bad_request', message: 'Expected { image: base64, mediaType }.' } });
    return;
  }

  // A real vision call takes a few seconds. Returning instantly would let a loading state
  // that looks fine today fall apart the day the real function lands.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const response: AnalyzeShelfResponse = { items: CANNED, stubbed: true };
  res.json(response);
});
