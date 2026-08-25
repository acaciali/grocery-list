import { onRequest } from 'firebase-functions/v2/https';
import { normalizeKey } from '@grocery/shared/items';

/**
 * Proves the Functions codebase builds, deploys, and is reachable.
 *
 * It deliberately calls normalizeKey(): Functions consume the shared contract as raw TS
 * bundled by esbuild, not as a published package, and that resolution is easy to break
 * from the far side of the monorepo. Asserting it here means a break surfaces as a failed
 * health check rather than as a wrong Kroger match weeks later.
 *
 * Import from '@grocery/shared/items', never the package root -- the root barrel pulls in
 * the client Firebase SDK, which has no business inside a Cloud Function.
 */
export const ping = onRequest((_req, res) => {
  res.json({
    ok: true,
    service: 'grocery-functions',
    sharedContract: normalizeKey('2 Gallons of Whole Milk'),
  });
});
