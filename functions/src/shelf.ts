/**
 * Pure logic for POST /analyzeShelf, extracted from the handler so it can be unit
 * tested without Firebase or the Anthropic API. vision.ts owns the I/O.
 */
import { normalizeKey } from '@grocery/shared/items';
import type { Category, ShelfCandidate } from '@grocery/shared/types';

export const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

/** ~6MB of base64 (~4.5MB image). A properly downscaled JPEG is ~200-500KB. */
export const MAX_IMAGE_B64_LENGTH = 6 * 1024 * 1024;

export interface ShelfRequest {
  image: string;
  mediaType: SupportedMediaType;
}

export type ValidationResult =
  | { ok: true; value: ShelfRequest }
  | { ok: false; error: string };

export function validateShelfRequest(body: unknown): ValidationResult {
  const { image, mediaType } = (body ?? {}) as { image?: unknown; mediaType?: unknown };

  if (typeof image !== 'string' || image.length === 0) {
    return { ok: false, error: 'Missing "image": a base64-encoded photo (no data: prefix).' };
  }
  if (image.startsWith('data:')) {
    return { ok: false, error: '"image" must be raw base64 without the data: URL prefix.' };
  }
  if (image.length > MAX_IMAGE_B64_LENGTH) {
    return {
      ok: false,
      error:
        'Image too large. Downscale to ~1568px on the long edge before uploading -- larger adds latency for zero accuracy gain.',
    };
  }
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType as SupportedMediaType)) {
    return {
      ok: false,
      error: `"mediaType" must be one of ${SUPPORTED_MEDIA_TYPES.join(', ')}. HEIC is not supported -- convert during the canvas downscale.`,
    };
  }
  return { ok: true, value: { image, mediaType: mediaType as SupportedMediaType } };
}

/** What the vision model returns per item, before we attach identity. */
export interface RawCandidate {
  name: string;
  brand: string | null;
  category: Category;
  confidence: number;
  note: string | null;
}

/**
 * Attach the cross-app identity to raw model output:
 * - every name runs through normalizeKey(), so the photo path produces the exact same
 *   key as manual entry, recipe import, and barcode lookup ⭐
 * - names that normalize to nothing (all quantity/descriptor words) are dropped rather
 *   than guessed at
 * - candidates that collapse to the SAME key are de-duped, keeping the highest
 *   confidence -- the review grid should show one card per distinct product
 */
export function toShelfCandidates(raw: RawCandidate[]): ShelfCandidate[] {
  const byKey = new Map<string, ShelfCandidate>();
  for (const candidate of raw) {
    let key;
    try {
      key = normalizeKey(candidate.name);
    } catch {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, { ...candidate, key });
    }
  }
  return [...byKey.values()];
}
