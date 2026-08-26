import { afterEach, describe, expect, it } from 'vitest';
import { assertAllowedRedirect, decodeState, deriveCallbackUrl, encodeState } from './oauth-state.js';

const ORIGINAL = process.env.APP_ALLOWED_ORIGINS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_ALLOWED_ORIGINS;
  else process.env.APP_ALLOWED_ORIGINS = ORIGINAL;
});

describe('state', () => {
  it('round-trips a uid and nonce', () => {
    const state = encodeState('abc123', 'ef2b1c4a-0000-4000-8000-000000000000');
    expect(decodeState(state)).toEqual({
      uid: 'abc123',
      nonce: 'ef2b1c4a-0000-4000-8000-000000000000',
    });
  });

  it.each(['', 'nodot', '.leadingdot', 'trailingdot.'])('rejects malformed state %j', (bad) => {
    expect(() => decodeState(bad)).toThrow(/malformed state/);
  });
});

describe('assertAllowedRedirect', () => {
  it('allows the dev origins by default', () => {
    expect(() => assertAllowedRedirect('http://localhost:5173/grocery?x=1')).not.toThrow();
  });

  it('rejects an unlisted origin', () => {
    expect(() => assertAllowedRedirect('https://evil.test/steal')).toThrow(/not allowed/);
  });

  /** The reason the check is origin-based rather than a prefix match. */
  it('rejects a lookalike host that merely starts with an allowed one', () => {
    process.env.APP_ALLOWED_ORIGINS = 'https://our-app.example.com';
    expect(() => assertAllowedRedirect('https://our-app.example.com.evil.test/')).toThrow(
      /not allowed/,
    );
  });

  it('rejects a non-http scheme that still parses as a URL', () => {
    expect(() => assertAllowedRedirect('javascript:alert(1)')).toThrow(/not allowed/);
  });

  it('rejects a string that is not a URL at all', () => {
    expect(() => assertAllowedRedirect('/grocery')).toThrow(/not a valid URL/);
  });

  it('honours APP_ALLOWED_ORIGINS, ignoring surrounding whitespace', () => {
    process.env.APP_ALLOWED_ORIGINS = ' https://app.example.com , https://staging.example.com ';
    expect(() => assertAllowedRedirect('https://staging.example.com/grocery')).not.toThrow();
    expect(() => assertAllowedRedirect('http://localhost:5173/')).toThrow(/not allowed/);
  });
});

describe('deriveCallbackUrl', () => {
  /** The emulator mounts every function at "/", so req.path can't be used to build this.
   *  That mistake produced `http://127.0.0.1:5001/` and would have failed silently. */
  it('builds the emulator path from project and region', () => {
    expect(
      deriveCallbackUrl({
        host: '127.0.0.1:5001',
        projectId: 'grocery-list-3dd86',
        region: 'us-central1',
        isEmulator: true,
      }),
    ).toBe('http://127.0.0.1:5001/grocery-list-3dd86/us-central1/krogerCallback');
  });

  it('appends only the function name when deployed', () => {
    expect(
      deriveCallbackUrl({
        host: 'us-central1-grocery-list-3dd86.cloudfunctions.net',
        projectId: 'grocery-list-3dd86',
        region: 'us-central1',
        isEmulator: false,
      }),
    ).toBe('https://us-central1-grocery-list-3dd86.cloudfunctions.net/krogerCallback');
  });

  it('stays on https for a non-local emulator host', () => {
    expect(
      deriveCallbackUrl({ host: 'tunnel.example.com', projectId: 'p', region: 'r', isEmulator: true }),
    ).toBe('https://tunnel.example.com/p/r/krogerCallback');
  });
});
