import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, krogerAuthUrl, krogerLinked } from './api';

/**
 * The user's Kroger authorization, which is a different grant from the one behind product
 * search: search runs on our client credentials, cart writes need this human to click
 * "allow" on Kroger's own site. That is why the list can price an item it cannot send.
 *
 * 'unknown' is a real state, not a placeholder -- it covers "not asked yet" and "we asked
 * and could not reach the endpoint", and neither is an honest 'unlinked'. Showing "link
 * your account" to someone already linked sends them through consent for nothing.
 */
export type LinkState = 'unknown' | 'linked' | 'unlinked';

/** What came back on the URL after the consent round-trip. */
export interface LinkNotice {
  kind: 'linked' | 'error';
  message: string;
}

const RETURN_PARAMS = ['kroger', 'reason'] as const;

/** The current URL with the handshake's own params removed -- where we want to come back to. */
function returnUrl(): string {
  const url = new URL(window.location.href);
  for (const param of RETURN_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

/**
 * Kroger reports a declined consent screen as an opaque reason string. Translating the
 * ones we cause ourselves is worth it; anything else is passed through rather than
 * flattened into "something went wrong", which tells nobody anything.
 */
function explain(reason: string | null): string {
  switch (reason) {
    case 'access_denied':
      return "Kroger didn't get your permission, so nothing is linked. Your list is untouched.";
    case 'missing_code':
      return 'Kroger sent us back without an authorization code. Try linking again.';
    case 'exchange_failed':
      return "Kroger wouldn't complete the link. Try again in a minute.";
    case null:
      return 'Linking was interrupted. Try again.';
    default:
      return `Linking failed (${reason}). Try again.`;
  }
}

/**
 * Read and clear the handshake result. Cleared with replaceState so a reload -- or the
 * back button -- doesn't replay a stale "linked!" banner, and so the redirect we hand
 * Kroger next time is not carrying the last round-trip's params.
 */
function takeReturnNotice(): LinkNotice | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('kroger');
  if (result === null) return null;
  const reason = params.get('reason');
  window.history.replaceState(null, '', returnUrl());
  return result === 'linked'
    ? { kind: 'linked', message: 'Your Kroger account is linked.' }
    : { kind: 'error', message: explain(reason) };
}

export interface KrogerLink {
  state: LinkState;
  /** A status check or the authorize hand-off is in flight. */
  busy: boolean;
  notice: LinkNotice | null;
  dismissNotice: () => void;
  /** Sends the browser to Kroger. Resolves only if it fails to get that far. */
  link: () => Promise<void>;
  /** For a send that came back 401: the stored authorization is gone, whatever we thought. */
  markUnlinked: () => void;
}

export function useKrogerLink(uid: string | null): KrogerLink {
  const [state, setState] = useState<LinkState>('unknown');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<LinkNotice | null>(null);
  const returnHandled = useRef(false);

  useEffect(() => {
    // Once per mount, before the status check: StrictMode double-invokes this, and the
    // second pass would find the params already stripped and clear a good notice.
    if (returnHandled.current) return;
    returnHandled.current = true;
    const found = takeReturnNotice();
    if (found === null) return;
    setNotice(found);
    if (found.kind === 'linked') setState('linked');
  }, []);

  useEffect(() => {
    if (uid === null) {
      setState('unknown');
      return;
    }
    const abort = new AbortController();
    setBusy(true);
    krogerLinked(uid, abort.signal)
      .then((linked) => setState(linked ? 'linked' : 'unlinked'))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        // Unreachable is not unlinked. Leaving it 'unknown' keeps the send button visible;
        // a send against dead authorization answers 401 and prompts properly then.
        console.error('kroger link status failed', err);
        setState('unknown');
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [uid]);

  const link = useCallback(async () => {
    if (uid === null) {
      setNotice({
        kind: 'error',
        message: "You're signed out, so there's no account to link to. Reload and try again.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const url = await krogerAuthUrl(uid, returnUrl());
      // Leaving the page for good, so nothing after this runs. assign, not replace: the
      // back button should return to the list rather than skipping past it.
      window.location.assign(url);
    } catch (err) {
      console.error('kroger authorize failed', err);
      setBusy(false);
      setNotice({
        kind: 'error',
        message:
          err instanceof ApiError && err.status === 400
            ? "This app's address isn't on the allowlist for Kroger linking. See APP_ALLOWED_ORIGINS."
            : "Couldn't reach Kroger to start linking. Try again in a minute.",
      });
    }
  }, [uid]);

  return {
    state,
    busy,
    notice,
    dismissNotice: () => setNotice(null),
    link,
    markUnlinked: () => setState('unlinked'),
  };
}
