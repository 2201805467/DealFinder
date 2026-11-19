import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { calculatedDiscount } from '../../services/money.js';
import { ProviderError } from '../provider-error.js';
import { SourceHttpClient } from '../source-http.js';
import type {
  ProductPage,
  ProductSearch,
  ProviderContext,
  StoreProduct,
  StoreProvider,
} from '../store-provider.js';

const money = z.string().regex(/^\d{1,8}\.\d{2}$/);
const dealSchema = z.object({
  gameID: z.string().regex(/^\d+$/),
  dealID: z.string().min(1).max(300),
  storeID: z.string().regex(/^\d+$/),
  title: z.string().trim().min(1).max(500),
  salePrice: money,
  normalPrice: money.optional(),
  isOnSale: z.enum(['0', '1']),
  thumb: z.url().optional(),
});
const storeSchema = z
  .array(
    z.object({
      storeID: z.string(),
      storeName: z.string().min(1),
      isActive: z.union([z.literal(0), z.literal(1)]),
    }),
  )
  .max(500);
export function cheapSharkLink(id: string) {
  const url = new URL('https://www.cheapshark.com/redirect');
  try {
    url.searchParams.set('dealID', decodeURIComponent(id));
  } catch {
    throw new ProviderError('INVALID_RESPONSE', 'Invalid deal identifier.');
  }
  return url.href;
}
export function normalizeCheapShark(
  raw: unknown,
  stores: ReadonlyMap<string, string>,
  fetchedAt: string,
): StoreProduct | undefined {
  const parsed = dealSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const d = parsed.data,
    store = stores.get(d.storeID);
  if (!store) return undefined;
  const current = new Prisma.Decimal(d.salePrice);
  const reference = d.normalPrice ? new Prisma.Decimal(d.normalPrice) : null;
  const trusted =
    d.isOnSale === '1' && reference !== null && reference.gt(current);
  return {
    externalId: d.gameID,
    store,
    name: d.title,
    currentPrice: current.toNumber(),
    ...(trusted && {
      originalPrice: reference.toNumber(),
      discountPercentage: calculatedDiscount(current, reference)!.toNumber(),
    }),
    currency: 'USD',
    productUrl: cheapSharkLink(d.dealID),
    ...(d.thumb?.startsWith('https://') && { imageUrl: d.thumb }),
    availability: 'available',
    fetchedAt,
    source: {
      key: 'CHEAPSHARK',
      itemId: d.dealID,
      retailerId: d.storeID,
      platforms: ['PC'],
      kind: 'game',
      attributionUrl: 'https://www.cheapshark.com/',
      referencePriceTrusted: trusted,
    },
  };
}
export class CheapSharkProvider implements StoreProvider {
  readonly name = 'CheapShark';
  readonly checkpointVersion = 'cheapshark-v1';
  readonly resumeAcrossRuns = false;
  readonly reportsRequests = true;
  readonly maxPageSize = 60;
  private stores?: { fetched: number; names: Map<string, string> };
  constructor(private readonly http = new SourceHttpClient()) {}
  async searchProducts(
    search: ProductSearch = {},
    context: ProviderContext = {},
  ): Promise<ProductPage> {
    const page = search.page ?? 1,
      pageSize = search.pageSize ?? 20;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 60 ||
      search.cursor ||
      (search.query?.length ?? 0) > 200
    )
      throw new ProviderError(
        'INVALID_SEARCH',
        'Invalid source pagination or search.',
      );
    if (!this.stores || Date.now() - this.stores.fetched > 300000) {
      const { data } = await this.http.get(
        new URL('https://www.cheapshark.com/api/1.0/stores'),
        context,
      );
      const parsed = storeSchema.safeParse(data);
      if (!parsed.success)
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Invalid retailer directory.',
        );
      this.stores = {
        fetched: Date.now(),
        names: new Map(
          parsed.data
            .filter((s) => s.isActive === 1)
            .map((s) => [s.storeID, s.storeName]),
        ),
      };
    }
    const url = new URL('https://www.cheapshark.com/api/1.0/deals');
    url.searchParams.set('pageNumber', String(page - 1));
    url.searchParams.set('pageSize', String(pageSize));
    if (search.query?.trim())
      url.searchParams.set('title', search.query.trim());
    if (search.discountedOnly) url.searchParams.set('onSale', '1');
    const { data, headers } = await this.http.get(url, context);
    if (!Array.isArray(data) || data.length > pageSize)
      throw new ProviderError('INVALID_RESPONSE', 'Invalid deals page.');
    const rawPages = headers.get('x-total-page-count');
    if (rawPages === null || !/^\d{1,8}$/.test(rawPages))
      throw new ProviderError('INVALID_RESPONSE', 'Missing page count.');
    const fetchedAt = new Date().toISOString();
    const products = data
      .map((d) => normalizeCheapShark(d, this.stores!.names, fetchedAt))
      .filter((p): p is StoreProduct => !!p);
    // API exposes a page count, not an exact item count. Do not invent total.
    return {
      products,
      totalPages: Number(rawPages),
      page,
      skippedCount: data.length - products.length,
    };
  }
}
