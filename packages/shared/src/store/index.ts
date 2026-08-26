/**
 * The store layer, shared by the browser and the Cloud Functions.
 *
 * Everything in here is pure: no Firebase SDK, no Node built-ins, no network. That is what
 * lets the same matching and the same mock fixtures run in a Cloud Function (live Kroger)
 * and in the browser (no backend at all, which is the only thing that works on the free
 * Firebase plan). A dependency added here that only one of those two can load breaks the
 * other silently, so keep this subtree pure.
 *
 * Imported as '@grocery/shared/store', never through the package root -- the root barrel
 * pulls in the client Firebase SDK, which has no business inside a Cloud Function.
 */
export type { CartLine, Modality, StoreAdapter } from './adapter.js';
export { MockStore } from './mock.js';
export {
  AUTO_ACCEPT_GAP,
  AUTO_ACCEPT_SCORE,
  fromRemembered,
  rank,
  score,
  toMatch,
  type Scored,
} from './matching.js';
export {
  MAX_LINES,
  validateLines,
  type CartRequestLine,
  type LineResult,
} from './cart-lines.js';
export { prefDocId, queryKey } from './prefs.js';
