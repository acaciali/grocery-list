import { randomUUID } from 'node:crypto';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { db, withDeadline } from './db.js';
import { fail, requireParam, requirePost } from './http.js';
import { validateLines, type CartRequestLine, type LineResult } from './cart-lines.js';
import {
  InvalidRedirectError,
  assertAllowedRedirect,
  decodeState,
  deriveCallbackUrl,
  encodeState,
} from './oauth-state.js';
import type { CartLine, Modality } from './stores/adapter.js';
import { adapter, isMock } from './stores/select.js';
import { clientId, exchangeAuthCode, krogerBaseUrl } from './stores/token.js';
import {
  NotLinkedError,
  isLinked,
  savePendingAuth,
  saveUserTokens,
  takePendingAuth,
  validUserToken,
} from './stores/userTokens.js';

/**
 * Cart push. Three OAuth endpoints plus the send itself.
 *
 * Cart writes need *user* authorization, which is a different grant from the
 * client-credentials token that covers products and locations. That is the whole reason
 * search is MVP and cart is bonus: this flow needs a registered redirect URI and a human
 * clicking "allow" on Kroger's site.
 */

const CART_SCOPE = 'cart.basic:write';

/**
 * Where Kroger sends the browser back. Must match the value registered in the Kroger dev
 * portal *exactly* -- a mismatch is rejected at the authorize step with an opaque error,
 * so it is worth failing loudly here instead.
 *
 * In mock mode we derive it from the request, so the whole flow is exercisable on a fresh
 * clone with no credentials and nothing registered anywhere.
 */
function callbackUrl(req: Request): string {
  const configured = process.env.KROGER_REDIRECT_URI;
  if (configured) return configured;
  if (isMock()) {
    return deriveCallbackUrl({
      host: req.get('host') ?? '127.0.0.1:5001',
      projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-project',
      region: process.env.FUNCTION_REGION ?? 'us-central1',
      isEmulator: process.env.FUNCTIONS_EMULATOR === 'true',
    });
  }
  throw new Error(
    'KROGER_REDIRECT_URI is not set. Register the callback URL in the Kroger dev portal ' +
      'and put the same value in functions/.env (or firebase functions:secrets:set).',
  );
}

export const krogerAuthUrl = onRequest({ cors: true }, async (req, res) => {
  const uid = requireParam(req, res, 'uid');
  if (!uid) return;
  const redirect = requireParam(req, res, 'redirect');
  if (!redirect) return;

  try {
    assertAllowedRedirect(redirect);
    const nonce = randomUUID();
    const callback = callbackUrl(req);
    await savePendingAuth(uid, { nonce, redirect, createdAtMs: Date.now() });

    const state = encodeState(uid, nonce);
    if (isMock()) {
      // Skip Kroger entirely: hand back our own callback so the frontend can drive the
      // full redirect round-trip without credentials or a registered URI.
      res.json({ url: `${callback}?code=mock-auth-code&state=${encodeURIComponent(state)}` });
      return;
    }

    const url = new URL('/v1/connect/oauth2/authorize', krogerBaseUrl());
    url.searchParams.set('client_id', clientId());
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', CART_SCOPE);
    url.searchParams.set('state', state);
    res.json({ url: url.toString() });
  } catch (err) {
    // Bad input from our own frontend, not an upstream outage.
    if (err instanceof InvalidRedirectError) {
      res.status(400).json({ error: err.message });
      return;
    }
    fail(res, err);
  }
});

/**
 * Kroger redirects the *browser* here, so every exit path is a redirect or human-readable
 * text -- never JSON. Errors go back to the app as a query param rather than dead-ending
 * the user on a blank page.
 */
export const krogerCallback = onRequest(async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';

  let uid: string;
  let nonce: string;
  try {
    ({ uid, nonce } = decodeState(state));
  } catch {
    // With no valid state there is no redirect we can trust. Stop here.
    res.status(400).type('text/plain').send('Invalid authorization state. Start linking again from the app.');
    return;
  }

  let appRedirect: string;
  try {
    appRedirect = (await takePendingAuth(uid, nonce)).redirect;
    assertAllowedRedirect(appRedirect);
  } catch (err) {
    console.error('kroger callback state check failed', err);
    res.status(400).type('text/plain').send('Authorization could not be verified. Start linking again from the app.');
    return;
  }

  const back = (params: Record<string, string>): void => {
    const url = new URL(appRedirect);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    res.redirect(302, url.toString());
  };

  // Kroger reports a declined consent screen as ?error=, with no code.
  if (typeof req.query.error === 'string') {
    back({ kroger: 'error', reason: req.query.error });
    return;
  }
  if (!code) {
    back({ kroger: 'error', reason: 'missing_code' });
    return;
  }

  try {
    const tokens = isMock()
      ? {
          accessToken: 'mock-user-access-token',
          refreshToken: 'mock-user-refresh-token',
          expiresAtMs: Date.now() + 30 * 60 * 1000,
        }
      : await exchangeAuthCode(code, callbackUrl(req));
    await saveUserTokens(uid, tokens);
    back({ kroger: 'linked' });
  } catch (err) {
    console.error('kroger code exchange failed', err);
    back({ kroger: 'error', reason: 'exchange_failed' });
  }
});

export const krogerStatus = onRequest({ cors: true }, async (req, res) => {
  const uid = requireParam(req, res, 'uid');
  if (!uid) return;
  try {
    res.json({ linked: await isLinked(uid) });
  } catch (err) {
    fail(res, err);
  }
});

// --- Sending ---------------------------------------------------------------------------

/**
 * One request per line, deliberately.
 *
 * Kroger's PUT /v1/cart/add takes an array but answers 204 or an error for the whole
 * call, and there is no read-back to reconcile against. Sending the batch and retrying
 * the failures individually would re-add anything that had already landed -- the exact
 * duplication this API makes impossible to detect. Per-line costs N calls against a
 * 5,000/day cap, which a grocery list will never approach, and buys results we can
 * actually show the user.
 */
async function sendLines(
  token: string,
  lines: CartRequestLine[],
  modality: Modality,
): Promise<LineResult[]> {
  const store = adapter();
  const results: LineResult[] = [];
  for (const line of lines) {
    const cartLine: CartLine = { upc: line.upc, quantity: line.quantity ?? 1 };
    try {
      await store.addToCart(token, [cartLine], modality);
      results.push({ itemId: line.itemId, ok: true });
    } catch (err) {
      console.error('cart line failed', line.itemId, err);
      results.push({
        itemId: line.itemId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export const addToCart = onRequest({ cors: true }, async (req, res) => {
  if (!requirePost(req, res)) return;

  const body = req.body as {
    uid?: string;
    locationId?: string;
    modality?: string;
    lines?: unknown;
  };
  const { uid, locationId } = body;
  const modality: Modality = body.modality === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';

  if (!uid || !locationId) {
    res.status(400).json({ error: 'uid and locationId are required' });
    return;
  }

  let lines: CartRequestLine[];
  try {
    lines = validateLines(body.lines);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    const token = isMock() ? 'mock-user-access-token' : await validUserToken(uid);
    const results = await sendLines(token, lines, modality);

    /**
     * The audit mirror. Kroger's Public API is write-only -- we cannot ask what is in the
     * cart, now or ever. This document is the only record that the send happened, which is
     * what lets the UI say "sent 4:12pm" instead of claiming to know the cart's contents.
     */
    const batch = db().collection('cartBatches').doc();
    await withDeadline(
      batch.set({
        uid,
        locationId,
        modality,
        sentAtMs: Date.now(),
        okCount: results.filter((r) => r.ok).length,
        failCount: results.filter((r) => !r.ok).length,
        lines: lines.map((l, i) => ({
          itemId: l.itemId,
          upc: l.upc,
          quantity: l.quantity ?? 1,
          ok: results[i]?.ok ?? false,
          error: results[i]?.error ?? null,
        })),
      }),
      'cart batch write',
    ).catch((err) => {
      // The send already happened. Losing the mirror is bad, but reporting failure would
      // invite a re-send, and a re-send duplicates.
      console.error('cartBatches write failed after a successful send', err);
    });

    res.json({ batchId: batch.id, results });
  } catch (err) {
    if (err instanceof NotLinkedError) {
      res.status(401).json({ error: err.message, linked: false });
      return;
    }
    fail(res, err);
  }
});
