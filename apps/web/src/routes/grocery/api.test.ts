import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The default matters more than it looks: it is what a fresh clone and a GitHub Pages
 * deploy get with no configuration, and the wrong default means a store surface that
 * silently fails against a Cloud Function nobody can deploy on the free plan.
 *
 * Both implementations are stubbed -- importing them for real initializes Firebase, which
 * has nothing to do with the question being asked here.
 */
vi.mock('./functionsStore', () => ({ functionsStore: { tag: 'functions' } }));
vi.mock('./localStore', () => ({ localStore: { tag: 'local' } }));

async function loadApi() {
  vi.resetModules();
  return import('./api');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('store mode', () => {
  it('defaults to the in-browser store, which is the only one Spark can run', async () => {
    const api = await loadApi();
    expect(api.storeMode).toBe('local');
    expect(api.isDemoStore).toBe(true);
  });

  it('uses the functions when asked explicitly', async () => {
    vi.stubEnv('VITE_STORE_MODE', 'functions');
    const api = await loadApi();
    expect(api.storeMode).toBe('functions');
    expect(api.isDemoStore).toBe(false);
  });

  it('treats a configured functions base as asking for the functions', async () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE', 'https://example.test/fns');
    const api = await loadApi();
    expect(api.storeMode).toBe('functions');
  });

  it('lets an explicit local mode win over a configured base', async () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE', 'https://example.test/fns');
    vi.stubEnv('VITE_STORE_MODE', 'local');
    const api = await loadApi();
    expect(api.storeMode).toBe('local');
  });

  it('ignores a value that is neither mode rather than failing to load', async () => {
    vi.stubEnv('VITE_STORE_MODE', 'kroger');
    const api = await loadApi();
    expect(api.storeMode).toBe('local');
  });
});
