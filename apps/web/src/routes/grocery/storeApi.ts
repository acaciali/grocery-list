/**
 * The contract between the grocery UI and whatever is answering store questions.
 *
 * Two implementations satisfy it: `functionsStore` (HTTP to our Cloud Functions, which is
 * the only way to reach live Kroger, because the client secret cannot live in a browser
 * and Kroger sends no CORS headers) and `localStore` (the mock, running entirely in the
 * page). `api.ts` picks one. Nothing else in the route knows which it got.
 *
 * Types and errors live here rather than in `api.ts` so both implementations can import
 * them without a cycle back through the module that chooses between them.
 */
import type { StoreLocation, StoreMatch, StoreProduct } from '@grocery/shared';

/**
 * Carries the HTTP status through, because one status is load-bearing: addToCart answers
 * 401 when the user's Kroger authorization is missing or dead, and that is a "link your
 * account" prompt rather than an error message. The local store raises the same shape for
 * the same condition, so the UI needs no special case.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ResolveInput {
  id: string;
  name: string;
}

/** The server caps a batch at 50; callers must slice before calling. */
export const RESOLVE_BATCH_LIMIT = 50;

/** Pickup or delivery. Kroger wants it per cart-add call, not per account. */
export type Modality = 'PICKUP' | 'DELIVERY';

/** Mirrors MAX_LINES in @grocery/shared/store. Callers must slice before sending. */
export const MAX_CART_LINES = 100;

export interface SendLine {
  itemId: string;
  upc: string;
  quantity: number;
}

export interface SendLineResult {
  itemId: string;
  ok: boolean;
  error?: string;
}

export interface SendResult {
  batchId: string;
  results: SendLineResult[];
}

export interface SendInput {
  uid: string;
  locationId: string;
  modality: Modality;
  lines: SendLine[];
}

export interface StoreApi {
  findStores(zip: string, signal?: AbortSignal): Promise<StoreLocation[]>;
  searchProducts(q: string, locationId: string, signal?: AbortSignal): Promise<StoreProduct[]>;
  resolveItems(
    locationId: string,
    items: ResolveInput[],
    uid: string | null,
    signal?: AbortSignal,
  ): Promise<Record<string, StoreMatch>>;
  rememberChoice(uid: string, term: string, product: StoreProduct): Promise<void>;
  krogerLinked(uid: string, signal?: AbortSignal): Promise<boolean>;
  krogerAuthUrl(uid: string, redirect: string): Promise<string>;
  sendToCart(input: SendInput): Promise<SendResult>;
}
