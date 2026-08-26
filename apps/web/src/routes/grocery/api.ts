/**
 * Which store implementation the grocery route talks to.
 *
 * Two modes, because of one platform fact: **deploying a Cloud Function requires the paid
 * Blaze plan.** On the free Spark plan there is no server, so the store has to run in the
 * page or not at all.
 *
 *   local     (default) -- mock fixtures in the browser. Works on Spark, works on static
 *                          hosting, works offline. Cannot reach Kroger.
 *   functions           -- HTTP to our Cloud Functions, which is the only path to live
 *                          Kroger. Needs Blaze, plus Kroger credentials for real data.
 *
 * `local` is the default so that a fresh clone and a GitHub Pages deploy both work with no
 * configuration, and so local development shows what the deployed app actually does. Opt
 * into the other mode in `apps/web/.env.local`:
 *
 *   VITE_STORE_MODE=functions       # + npm run emulators, or a deployed project
 *
 * Setting VITE_FUNCTIONS_BASE implies it too -- naming a backend is asking to use it.
 *
 * Every call site imports from this module and none of them know which mode is live. The
 * one thing they must respect is `isDemoStore`: fixture prices presented as real ones is
 * the failure mode this whole seam has to avoid.
 */
import { functionsStore } from './functionsStore';
import { localStore } from './localStore';
import type { StoreApi } from './storeApi';

export {
  ApiError,
  MAX_CART_LINES,
  RESOLVE_BATCH_LIMIT,
  type Modality,
  type ResolveInput,
  type SendInput,
  type SendLine,
  type SendLineResult,
  type SendResult,
} from './storeApi';

export type StoreMode = 'local' | 'functions';

function resolveMode(): StoreMode {
  const configured = import.meta.env.VITE_STORE_MODE;
  if (configured === 'functions' || configured === 'local') return configured;
  return import.meta.env.VITE_FUNCTIONS_BASE ? 'functions' : 'local';
}

export const storeMode: StoreMode = resolveMode();

/**
 * True when every product, price, and store on screen is a fixture. The UI is required to
 * label this -- same rule the shelf scanner follows for its stub data, for the same reason:
 * a canned result must never be mistaken for a real one.
 */
export const isDemoStore = storeMode === 'local';

const impl: StoreApi = storeMode === 'functions' ? functionsStore : localStore;

export const findStores: StoreApi['findStores'] = (...args) => impl.findStores(...args);
export const searchProducts: StoreApi['searchProducts'] = (...args) => impl.searchProducts(...args);
export const resolveItems: StoreApi['resolveItems'] = (...args) => impl.resolveItems(...args);
export const rememberChoice: StoreApi['rememberChoice'] = (...args) => impl.rememberChoice(...args);
export const krogerLinked: StoreApi['krogerLinked'] = (...args) => impl.krogerLinked(...args);
export const krogerAuthUrl: StoreApi['krogerAuthUrl'] = (...args) => impl.krogerAuthUrl(...args);
export const sendToCart: StoreApi['sendToCart'] = (...args) => impl.sendToCart(...args);
