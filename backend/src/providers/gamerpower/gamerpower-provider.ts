import { z } from 'zod';
import { ProviderError } from '../provider-error.js';
import { SourceHttpClient } from '../source-http.js';
import type {
  ProductPage,
  ProductSearch,
  ProviderContext,
  StoreProduct,
  StoreProvider,
} from '../store-provider.js';

const giveawaySchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).optional(),
  image: z.url().optional(),
  thumbnail: z.url().optional(),
  open_giveaway_url: z.url(),
  platforms: z.string().max(2000),
  type: z.enum(['Game', 'DLC', 'Loot', 'Early Access', 'Other']),
  status: z.string(),
  end_date: z.string().max(100),
});
/** Source omits timezone. Earliest plausible UTC expiry avoids promising availability too long. */
export function conservativeGiveawayEnd(text: string): string | undefined {
  if (text === 'N/A') return undefined;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return undefined;
  const utc = Date.parse(text.replace(' ', 'T') + 'Z');
  if (
    !Number.isFinite(utc) ||
    new Date(utc).toISOString().slice(0, 19) !== text.replace(' ', 'T')
  )
    return undefined;
  return new Date(utc - 14 * 3600000).toISOString();
}
export function normalizeGamerPower(
  raw: unknown,
  fetchedAt: string,
): StoreProduct | undefined {
  const parsed = giveawaySchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const g = parsed.data;
  const image = g.image ?? g.thumbnail;
  const link = new URL(g.open_giveaway_url);
  if (
    g.status !== 'Active' ||
    link.username !== '' ||
    link.password !== '' ||
    link.hash !== '' ||
    link.origin !== 'https://www.gamerpower.com' ||
    !link.pathname.startsWith('/open/')
  )
    return undefined;
  const endsAt = conservativeGiveawayEnd(g.end_date);
  if ((g.end_date !== 'N/A' && !endsAt) || (endsAt && endsAt <= fetchedAt))
    return undefined;
  return {
    externalId: String(g.id),
    store: 'Giveaway publisher not specified',
    name: g.title,
    ...(g.description && { description: g.description }),
    ...(image?.startsWith('https://') && { imageUrl: image }),
    currentPrice: 0,
    currency: 'USD',
    productUrl: link.href,
    availability: 'available',
    fetchedAt,
    // `worth` is an estimate, not evidence of an actual prior price. Never compute a discount from it.
    source: {
      key: 'GAMERPOWER',
      itemId: String(g.id),
      retailerId: 'unspecified',
      platforms: g.platforms
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 30),
      kind:
        g.type === 'Game'
          ? 'game'
          : g.type === 'DLC'
            ? 'dlc'
            : g.type === 'Loot'
              ? 'loot'
              : g.type === 'Early Access'
                ? 'beta'
                : 'giveaway',
      attributionUrl: 'https://www.gamerpower.com/',
      referencePriceTrusted: false,
      ...(endsAt && { endsAt }),
      ...(g.end_date !== 'N/A' && { endText: g.end_date }),
    },
  };
}
export class GamerPowerProvider implements StoreProvider {
  readonly name = 'GamerPower';
  readonly checkpointVersion = 'gamerpower-v1';
  readonly resumeAcrossRuns = false;
  readonly reportsRequests = true;
  private snapshot: StoreProduct[] | undefined;
  private omitted = 0;
  constructor(private readonly http = new SourceHttpClient()) {}
  beginRun() {
    this.snapshot = undefined;
    this.omitted = 0;
  }
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
      pageSize > 100 ||
      search.cursor ||
      (search.query?.length ?? 0) > 200
    )
      throw new ProviderError(
        'INVALID_SEARCH',
        'Invalid source pagination or search.',
      );
    // None of this feed's estimated worth values establish a trusted discount.
    if (search.discountedOnly)
      return { products: [], total: 0, totalPages: 0, page, skippedCount: 0 };
    if (!this.snapshot) {
      const { data } = await this.http.get(
        new URL('https://www.gamerpower.com/api/giveaways'),
        context,
        true,
      );
      if (!Array.isArray(data) || data.length > 5000)
        throw new ProviderError('INVALID_RESPONSE', 'Invalid giveaways feed.');
      const fetchedAt = new Date().toISOString();
      this.snapshot = data
        .map((d) => normalizeGamerPower(d, fetchedAt))
        .filter((p): p is StoreProduct => !!p);
      // Expired/inactive giveaways are expected exclusions, not a failed page.
      this.omitted = data.filter(
        (d) => !giveawaySchema.safeParse(d).success,
      ).length;
    }
    // Official API has no pagination. One immutable, bounded feed snapshot is sliced locally per run.
    const filtered = this.snapshot.filter(
      (p) =>
        !search.query ||
        p.name.toLowerCase().includes(search.query.toLowerCase()),
    );
    return {
      products: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / pageSize),
      page,
      skippedCount: page === 1 ? this.omitted : 0,
    };
  }
}
