import type { StoreLocation, StoreProduct } from '@grocery/shared/types';

export type Modality = 'PICKUP' | 'DELIVERY';

export interface CartLine {
  upc: string;
  quantity: number;
}

/**
 * The seam between our app and any store. The UI and the resolver only speak this
 * interface, so store #2 is a new file, not a rewrite -- and the whole product is
 * buildable against MockStore with no credentials at all.
 */
export interface StoreAdapter {
  findStores(zip: string): Promise<StoreLocation[]>;
  searchProducts(term: string, locationId: string, limit?: number): Promise<StoreProduct[]>;
  /**
   * Push lines into the user's store cart. One-way: the Public API offers no read-back,
   * so callers must record what they sent (cartBatches) as the only cart state we have.
   * Throws on failure of the whole call; per-line results come from callers chunking.
   */
  addToCart(userAccessToken: string, lines: CartLine[], modality: Modality): Promise<void>;
}
