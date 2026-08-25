/**
 * Cloud Functions live here when code needs a secret (Kroger client secret, Anthropic
 * API key) or a CORS proxy. Exports only -- implementations go in per-team files
 * (recipes.ts, stores.ts, vision.ts, ai.ts) as they land.
 */
import { onRequest } from 'firebase-functions/v2/https';

/** Phase 0 hello world: proves the functions toolchain builds, emulates, and deploys. */
export const ping = onRequest((req, res) => {
  res.json({ ok: true, from: 'functions', at: new Date().toISOString() });
});
