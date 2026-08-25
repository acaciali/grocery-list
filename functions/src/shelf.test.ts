/**
 * Proves the photo path's identity handling: generic names → the same normalized key
 * as every other path, unidentifiable names dropped, same-key candidates de-duped.
 */
import { describe, expect, it } from 'vitest';
import { normalizeKey } from '@grocery/shared/items';
import type { Category } from '@grocery/shared/types';
import {
  MAX_IMAGE_B64_LENGTH,
  toShelfCandidates,
  validateShelfRequest,
  type RawCandidate,
} from './shelf';

const raw = (overrides: Partial<RawCandidate> = {}): RawCandidate => ({
  name: 'black beans',
  brand: null,
  category: 'canned' as Category,
  confidence: 0.9,
  note: null,
  ...overrides,
});

describe('validateShelfRequest', () => {
  it('accepts a well-formed request', () => {
    const result = validateShelfRequest({ image: 'AAAA', mediaType: 'image/jpeg' });
    expect(result).toEqual({ ok: true, value: { image: 'AAAA', mediaType: 'image/jpeg' } });
  });

  it.each([
    ['missing body', undefined, /Missing "image"/],
    ['empty image', { image: '', mediaType: 'image/png' }, /Missing "image"/],
    ['non-string image', { image: 42, mediaType: 'image/png' }, /Missing "image"/],
    ['data: URL prefix', { image: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, /raw base64/],
    ['HEIC', { image: 'AAAA', mediaType: 'image/heic' }, /HEIC is not supported/],
    ['missing mediaType', { image: 'AAAA' }, /mediaType/],
  ])('rejects %s', (_label, body, expected) => {
    const result = validateShelfRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(expected);
  });

  it('rejects an image over the size cap with downscaling guidance', () => {
    const result = validateShelfRequest({
      image: 'A'.repeat(MAX_IMAGE_B64_LENGTH + 1),
      mediaType: 'image/jpeg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/1568px/);
  });
});

describe('toShelfCandidates -- the generalized-identity contract', () => {
  it('gives every candidate the same key the recipe and manual paths would produce', () => {
    const [candidate] = toShelfCandidates([raw({ name: 'black beans' })]);
    expect(candidate?.key).toBe(normalizeKey('1 (15 oz) can black beans')); // recipe line
    expect(candidate?.key).toBe(normalizeKey('Black Beans'));               // manual entry
  });

  it('keeps the brand as metadata without baking it into the key', () => {
    const [candidate] = toShelfCandidates([raw({ name: 'black beans', brand: "Bush's" })]);
    expect(candidate?.brand).toBe("Bush's");
    expect(candidate?.key).toBe('black-bean'); // identity stays generic
  });

  it('de-dupes candidates that normalize to the same key, keeping the higher confidence', () => {
    const candidates = toShelfCandidates([
      raw({ name: 'black beans', confidence: 0.6, note: 'partially occluded' }),
      raw({ name: 'Black Beans', confidence: 0.95 }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.confidence).toBe(0.95);
    expect(candidates[0]?.note).toBeNull(); // the winning candidate's fields, not a merge
  });

  it('drops a name that normalizes to nothing instead of guessing', () => {
    const candidates = toShelfCandidates([
      raw({ name: '2 cups' }), // all quantity words -- normalizeKey throws
      raw({ name: 'olive oil' }),
    ]);
    expect(candidates.map((c) => c.key)).toEqual(['olive-oil']);
  });

  it('passes category, confidence, and note through untouched', () => {
    const [candidate] = toShelfCandidates([
      raw({ name: 'frozen peas', category: 'frozen' as Category, confidence: 0.42, note: 'behind glass' }),
    ]);
    expect(candidate).toMatchObject({
      key: 'pea', // 'frozen' is a state descriptor, dropped; plural collapses
      category: 'frozen',
      confidence: 0.42,
      note: 'behind glass',
    });
  });

  it('returns an empty list for an empty shelf, not an error', () => {
    expect(toShelfCandidates([])).toEqual([]);
  });
});
