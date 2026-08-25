import type { Category, StoreLocation, StoreProduct } from '@grocery/shared/types';
import type { CartLine, Modality, StoreAdapter } from './adapter.js';
import { clientToken, invalidateClientToken, krogerBaseUrl } from './token.js';

/** Kroger department strings -> our Category union. Anything unmapped falls to 'other'. */
const CATEGORY_MAP: Array<[RegExp, Category]> = [
  [/produce/i, 'produce'],
  [/dairy|eggs/i, 'dairy'],
  [/meat/i, 'meat'],
  [/seafood/i, 'seafood'],
  [/bakery|bread/i, 'bakery'],
  [/canned/i, 'canned'],
  [/frozen/i, 'frozen'],
  [/spice|seasoning/i, 'spices'],
  [/beverage|soft drink/i, 'beverages'],
  [/pantry|baking|pasta|cereal|snack|condiment/i, 'pantry'],
];

function toCategory(departments: string[] | undefined): Category | null {
  for (const d of departments ?? []) {
    for (const [re, cat] of CATEGORY_MAP) if (re.test(d)) return cat;
  }
  return departments?.length ? 'other' : null;
}

// The slices of Kroger's response shapes we actually read.
interface KrogerLocation {
  locationId: string;
  chain?: string;
  name?: string;
  address?: { addressLine1?: string; city?: string; state?: string; zipCode?: string };
}

interface KrogerProduct {
  productId: string;
  upc?: string;
  brand?: string;
  description?: string;
  categories?: string[];
  items?: Array<{
    upc?: string;
    size?: string;
    price?: { regular?: number; promo?: number };
    inventory?: { stockLevel?: string };
  }>;
  images?: Array<{
    perspective?: string;
    sizes?: Array<{ size?: string; url?: string }>;
  }>;
}

function imageUrl(p: KrogerProduct): string | null {
  const front = p.images?.find((i) => i.perspective === 'front') ?? p.images?.[0];
  const medium = front?.sizes?.find((s) => s.size === 'medium') ?? front?.sizes?.[0];
  return medium?.url ?? null;
}

function toStockLevel(raw: string | undefined): StoreProduct['stockLevel'] {
  return raw === 'HIGH' || raw === 'LOW' || raw === 'TEMPORARILY_OUT_OF_STOCK' ? raw : null;
}

function toProduct(p: KrogerProduct): StoreProduct | null {
  const item = p.items?.[0];
  // No UPC means it can never reach the cart; drop it rather than dead-ending later.
  const upc = item?.upc ?? p.upc;
  if (!upc) return null;
  const promo = item?.price?.promo;
  return {
    productId: p.productId,
    upc,
    name: p.description ?? p.productId,
    brand: p.brand ?? null,
    size: item?.size ?? null,
    imageUrl: imageUrl(p),
    price: item?.price?.regular ?? null,
    // Kroger sends promo: 0 for "no promo" -- keep that out of the UI.
    promoPrice: promo ? promo : null,
    stockLevel: toStockLevel(item?.inventory?.stockLevel),
    category: toCategory(p.categories),
  };
}

export class KrogerStore implements StoreAdapter {
  /** One retry after invalidating the cached token -- 401 here means "token aged out". */
  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${krogerBaseUrl()}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await clientToken()}`, Accept: 'application/json' },
      });
      if (res.status === 401 && attempt === 0) {
        invalidateClientToken();
        continue;
      }
      if (!res.ok) throw new Error(`Kroger GET ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res.json();
    }
  }

  async findStores(zip: string): Promise<StoreLocation[]> {
    const body = (await this.get('/v1/locations', {
      'filter.zipCode.near': zip,
      'filter.limit': '10',
    })) as { data?: KrogerLocation[] };
    return (body.data ?? []).map((l) => ({
      locationId: l.locationId,
      name: l.name ?? l.chain ?? l.locationId,
      address: [l.address?.addressLine1, l.address?.city, l.address?.state, l.address?.zipCode]
        .filter(Boolean)
        .join(', '),
      chain: l.chain ?? null,
    }));
  }

  async searchProducts(term: string, locationId: string, limit = 10): Promise<StoreProduct[]> {
    const body = (await this.get('/v1/products', {
      'filter.term': term,
      // Without a locationId Kroger omits price and stock entirely; it is required here.
      'filter.locationId': locationId,
      'filter.limit': String(limit),
    })) as { data?: KrogerProduct[] };
    return (body.data ?? []).map(toProduct).filter((p): p is StoreProduct => p !== null);
  }

  async addToCart(userAccessToken: string, lines: CartLine[], modality: Modality): Promise<void> {
    const res = await fetch(`${krogerBaseUrl()}/v1/cart/add`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: lines.map((l) => ({ upc: l.upc, quantity: l.quantity, modality })),
      }),
    });
    // Success is 204 No Content. There is no read-back; the caller records what was sent.
    if (!res.ok) throw new Error(`Kroger cart/add ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
