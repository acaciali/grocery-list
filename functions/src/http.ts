import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

/**
 * Config problems are ours to fix and should be loud (500); upstream store failures are
 * someone else's outage (502). The client renders those differently -- "we're broken" is
 * not the same message as "Kroger is down, try again".
 */
export function fail(res: Response, err: unknown): void {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  res.status(msg.includes('not set') ? 500 : 502).json({ error: msg });
}

export function requireParam(req: Request, res: Response, name: string): string | null {
  const v = req.query[name];
  if (typeof v === 'string' && v.length > 0) return v;
  res.status(400).json({ error: `missing required query param: ${name}` });
  return null;
}

/** POST-only guard. Returns false and answers the request when the method is wrong. */
export function requirePost(req: Request, res: Response): boolean {
  if (req.method === 'POST') return true;
  res.status(405).json({ error: 'POST only' });
  return false;
}
