/**
 * Pure helpers for the Kroger user-authorization handshake. Kept free of the Functions
 * runtime and Firestore so the security-critical parts -- state parsing and the redirect
 * allowlist -- are unit-testable.
 */

/**
 * We 302 the browser to a caller-supplied URL at the end of the handshake, so that URL is
 * an open redirect unless it is checked. Allowlist by origin, not by prefix: a prefix test
 * lets `https://our-app.example.com.evil.test` through.
 */
export function allowedOrigins(): string[] {
  const configured = process.env.APP_ALLOWED_ORIGINS;
  if (configured) return configured.split(',').map((o) => o.trim()).filter(Boolean);
  return ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

/** Distinguishes "our own frontend sent a bad redirect" (400) from an upstream fault. */
export class InvalidRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRedirectError';
  }
}

export function assertAllowedRedirect(redirect: string): void {
  let origin: string;
  try {
    origin = new URL(redirect).origin;
  } catch {
    throw new InvalidRedirectError('redirect is not a valid URL');
  }
  // A URL like `javascript:...` parses fine and has origin "null".
  if (origin === 'null' || !allowedOrigins().includes(origin)) {
    throw new InvalidRedirectError(
      `redirect origin ${origin} is not allowed. Add it to APP_ALLOWED_ORIGINS.`,
    );
  }
}

/**
 * `state` carries the uid so the callback -- which Kroger hits with no session of any
 * kind -- knows whose tokens it is storing, and a nonce that is checked against the doc
 * we stored before redirecting. The uid alone would be forgeable; the nonce is what makes
 * it a CSRF defence.
 */
export const encodeState = (uid: string, nonce: string): string => `${uid}.${nonce}`;

export function decodeState(state: string): { uid: string; nonce: string } {
  const dot = state.indexOf('.');
  if (dot <= 0 || dot === state.length - 1) throw new Error('malformed state');
  // Split on the FIRST dot: nonces are UUIDs and contain none, but a uid never should
  // either -- taking the last dot would silently mis-attribute tokens if that changed.
  return { uid: state.slice(0, dot), nonce: state.slice(dot + 1) };
}

/**
 * The callback URL to hand Kroger when KROGER_REDIRECT_URI is unset -- mock mode only.
 *
 * It cannot be derived from `req.path`: the Functions emulator mounts each function at
 * the root, so `req.path` is always "/" and the function name is nowhere in it. The two
 * URL shapes have to be spelled out instead.
 *
 * Deployed, `host` is already the function's own host, so the name is all that is missing.
 * In the emulator, functions live under /{projectId}/{region}/{name}.
 */
export function deriveCallbackUrl(opts: {
  host: string;
  projectId: string;
  region: string;
  isEmulator: boolean;
}): string {
  const { host, projectId, region, isEmulator } = opts;
  if (!isEmulator) return `https://${host}/krogerCallback`;
  const proto = /^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https';
  return `${proto}://${host}/${projectId}/${region}/krogerCallback`;
}
