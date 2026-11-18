import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../utils/app-error.js';
import type { CatalogQuery } from './catalog-query.js';
import {
  dealScoreSql,
  defaultScoringRules,
  evaluateDeal,
  type ScoringRules,
} from '../scoring/deal-scoring.js';

const merchantSelect = {
  id: true,
  name: true,
  sourceType: true,
  websiteUrl: true,
  enabled: true,
  isSynthetic: true,
} as const;
const productSelect = {
  id: true,
  name: true,
  description: true,
  categoryId: true,
  imageUrl: true,
  isSynthetic: true,
  createdAt: true,
  updatedAt: true,
} as const;
const offerInclude = {
  merchant: { select: merchantSelect },
  product: { select: productSelect },
} as const;
type Offer = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;
function offerDto(offer: Offer, now = new Date(), rules = defaultScoringRules) {
  const score = evaluateDeal(
    { ...offer, imageUrl: offer.product.imageUrl },
    now,
    rules,
  );
  return {
    id: offer.id,
    product: offer.product,
    merchant: offer.merchant,
    externalProductId: offer.externalProductId,
    variantKey: offer.variantKey || null,
    currentPrice: offer.currentPrice?.toFixed() ?? null,
    referencePrice: offer.referencePrice?.toFixed() ?? null,
    discountPercentage: offer.discountPercentage?.toFixed() ?? null,
    currency: offer.currency || null,
    market: offer.market || null,
    productUrl: offer.productUrl,
    affiliateUrl: offer.affiliateUrl,
    availability: offer.availability,
    lastUpdatedAt: offer.lastUpdatedAt,
    expiresAt: offer.expiresAt,
    isSynthetic: offer.isSynthetic,
    isStale: score.isStale,
    referencePriceTrusted: offer.referencePriceTrusted,
    shippingCost: offer.shippingCost?.toFixed() ?? null,
    dealScore: score.score,
    scoreClassification: score.classification,
    scoreComponents: score.components,
    scoreReasons: score.reasons,
  };
}
const liveAt = (now: Date) => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});
export class CatalogService {
  constructor(
    private readonly db: PrismaClient,
    private readonly includeSynthetic = false,
    private readonly rules: ScoringRules = defaultScoringRules,
  ) {}

  private merchantWhere(): Prisma.MerchantWhereInput {
    return {
      enabled: true,
      storageAuthorized: true,
      ...(!this.includeSynthetic && { isSynthetic: false }),
    };
  }
  private productWhere(now: Date): Prisma.ProductWhereInput {
    return {
      ...liveAt(now),
      contentMerchant: this.merchantWhere(),
      ...(!this.includeSynthetic && { isSynthetic: false }),
    };
  }
  private offerWhere(
    query: CatalogQuery,
    now: Date,
    deals: boolean,
  ): Prisma.OfferWhereInput {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      new Prisma.Decimal(query.minPrice).gt(query.maxPrice)
    )
      throw new AppError(
        400,
        'INVALID_QUERY',
        'minPrice must not exceed maxPrice.',
      );
    return {
      AND: [liveAt(now)],
      merchant: this.merchantWhere(),
      product: {
        ...this.productWhere(now),
        ...(query.q && {
          name: {
            contains: query.q.replace(/[\\%_]/g, '\\$&'),
            mode: 'insensitive',
          },
        }),
        ...(query.categoryId && { categoryId: query.categoryId }),
      },
      ...(!this.includeSynthetic && { isSynthetic: false }),
      ...(query.merchantId && { merchantId: query.merchantId }),
      ...(query.market && { market: query.market }),
      ...(query.currency && { currency: query.currency }),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            currentPrice: {
              ...(query.minPrice !== undefined && {
                gte: new Prisma.Decimal(query.minPrice),
              }),
              ...(query.maxPrice !== undefined && {
                lte: new Prisma.Decimal(query.maxPrice),
              }),
            },
          }
        : {}),
      ...(query.sort.startsWith('price_') &&
        query.minPrice === undefined &&
        query.maxPrice === undefined && { currentPrice: { not: null } }),
      ...(deals && {
        ...(query.view !== 'low_price' && {
          discountPercentage: { gt: 0 },
          referencePriceTrusted: true,
        }),
        staleAt: { gt: now },
        currentPrice: {
          not: null,
          ...(query.minPrice !== undefined && {
            gte: new Prisma.Decimal(query.minPrice),
          }),
          ...(query.maxPrice !== undefined && {
            lte: new Prisma.Decimal(query.maxPrice),
          }),
        },
        availability: { not: 'UNAVAILABLE' },
      }),
    };
  }
  private order(query: CatalogQuery): Prisma.OfferOrderByWithRelationInput[] {
    if (query.sort === 'price_asc')
      return [{ currentPrice: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    if (query.sort === 'price_desc')
      return [{ currentPrice: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    if (query.sort === 'discount_desc')
      return [
        { discountPercentage: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ];
    return [{ lastUpdatedAt: 'desc' }, { id: 'asc' }];
  }
  async deals(query: CatalogQuery) {
    const now = new Date();
    this.offerWhere(query, now, true); // shared validation, including price bounds
    const clauses = this.sqlFilters(query, now);
    clauses.push(
      Prisma.sql`o.stale_at > ${now} AND o.current_price IS NOT NULL AND o.currency ~ '^[A-Z]{3}$' AND o.availability <> 'UNAVAILABLE'`,
    );
    if (query.view !== 'low_price')
      clauses.push(
        Prisma.sql`o.reference_price_trusted AND o.discount_percentage > 0 AND o.reference_price > o.current_price AND o.reference_price > 0`,
      );
    const score = dealScoreSql(now, this.rules);
    if (query.view === 'top')
      clauses.push(
        Prisma.sql`o.availability = 'AVAILABLE' AND (${score}) >= ${this.rules.topThreshold}`,
      );
    const order =
      query.sort === 'score_desc'
        ? Prisma.sql`(${score}) DESC`
        : query.sort === 'price_asc'
          ? Prisma.sql`o.current_price ASC`
          : query.sort === 'price_desc'
            ? Prisma.sql`o.current_price DESC`
            : query.sort === 'discount_desc'
              ? Prisma.sql`o.discount_percentage DESC NULLS LAST`
              : Prisma.sql`o.last_updated_at DESC`;
    const from = Prisma.sql`FROM offers o JOIN products p ON p.id=o.product_id JOIN merchants m ON m.id=o.merchant_id JOIN merchants cm ON cm.id=p.content_merchant_id WHERE ${Prisma.join(clauses, ' AND ')}`;
    return this.db.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT count(*) AS total ${from}`,
        );
        const ids = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT o.id ${from} ORDER BY ${order}, o.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        );
        const rows = await tx.offer.findMany({
          where: { id: { in: ids.map((row) => row.id) } },
          include: offerInclude,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        return {
          data: ids.map(({ id }) => offerDto(byId.get(id)!, now, this.rules)),
          pagination: this.page(query, Number(counts[0]!.total)),
          selection: query.view ?? 'discounted',
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async deal(id: string) {
    const query = { page: 1, pageSize: 20, sort: 'newest' } as CatalogQuery;
    const now = new Date();
    const offer = await this.db.offer.findFirst({
      where: { ...this.offerWhere(query, now, true), id },
      include: offerInclude,
    });
    if (!offer) throw new AppError(404, 'NOT_FOUND', 'Deal not found.');
    return { data: offerDto(offer, now, this.rules) };
  }
  private sqlFilters(query: CatalogQuery, now: Date): Prisma.Sql[] {
    const clauses = [
      Prisma.sql`(o.expires_at IS NULL OR o.expires_at > ${now})`,
      Prisma.sql`(p.expires_at IS NULL OR p.expires_at > ${now})`,
      Prisma.sql`m.enabled AND m.storage_authorized AND cm.enabled AND cm.storage_authorized`,
    ];
    if (!this.includeSynthetic)
      clauses.push(
        Prisma.sql`NOT p.is_synthetic AND NOT o.is_synthetic AND NOT m.is_synthetic AND NOT cm.is_synthetic`,
      );
    if (query.q)
      clauses.push(Prisma.sql`strpos(lower(p.name), lower(${query.q})) > 0`);
    if (query.categoryId)
      clauses.push(Prisma.sql`p.category_id=${query.categoryId}::uuid`);
    if (query.merchantId)
      clauses.push(Prisma.sql`o.merchant_id=${query.merchantId}::uuid`);
    if (query.market) clauses.push(Prisma.sql`o.market=${query.market}`);
    if (query.currency) clauses.push(Prisma.sql`o.currency=${query.currency}`);
    if (query.minPrice !== undefined)
      clauses.push(Prisma.sql`o.current_price>=${query.minPrice}::numeric`);
    if (query.maxPrice !== undefined)
      clauses.push(Prisma.sql`o.current_price<=${query.maxPrice}::numeric`);
    return clauses;
  }
  async products(query: CatalogQuery) {
    const now = new Date();
    const filter = this.offerWhere(query, now, false);
    // GROUP BY is performed by PostgreSQL before pagination; never paginate offers
    // and then deduplicate products in memory. Aggregates use only matching offers.
    const clauses = this.sqlFilters(query, now);
    if (query.sort.startsWith('price_'))
      clauses.push(Prisma.sql`o.current_price IS NOT NULL`);
    const order =
      query.sort === 'score_desc'
        ? Prisma.sql`max(${dealScoreSql(now, this.rules)}) DESC`
        : query.sort === 'price_asc'
          ? Prisma.sql`min(o.current_price) ASC NULLS LAST`
          : query.sort === 'price_desc'
            ? Prisma.sql`min(o.current_price) DESC NULLS LAST`
            : query.sort === 'discount_desc'
              ? Prisma.sql`max(o.discount_percentage) DESC NULLS LAST`
              : Prisma.sql`max(o.last_updated_at) DESC`;
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.product.count({
          where: { offers: { some: filter } },
        });
        const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT p.id FROM products p JOIN offers o ON o.product_id = p.id
        JOIN merchants m ON m.id = o.merchant_id JOIN merchants cm ON cm.id = p.content_merchant_id
        WHERE ${Prisma.join(clauses, ' AND ')} GROUP BY p.id ORDER BY ${order}, p.id ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
        const rows = await tx.product.findMany({
          where: { id: { in: ids.map((row) => row.id) } },
          select: {
            ...productSelect,
            category: true,
            offers: {
              where: filter,
              include: offerInclude,
              orderBy: this.order(query),
            },
          },
        });
        const map = new Map(rows.map((row) => [row.id, row]));
        return {
          data: ids.map(({ id }) => {
            const row = map.get(id)!;
            return {
              ...row,
              offers: row.offers.map((offer) =>
                offerDto(offer, now, this.rules),
              ),
            };
          }),
          pagination: this.page(query, total),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async product(id: string) {
    const now = new Date();
    const filter = this.offerWhere(
      { page: 1, pageSize: 20, sort: 'newest' },
      now,
      false,
    );
    const row = await this.db.product.findFirst({
      where: { id, ...this.productWhere(now), offers: { some: filter } },
      select: {
        ...productSelect,
        category: true,
        offers: {
          where: filter,
          include: offerInclude,
          orderBy: [{ lastUpdatedAt: 'desc' }, { id: 'asc' }],
        },
      },
    });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
    return {
      data: {
        ...row,
        offers: row.offers.map((offer) => offerDto(offer, now, this.rules)),
      },
    };
  }
  async categories(query: CatalogQuery) {
    const where = this.includeSynthetic ? {} : { isSynthetic: false };
    const [data, total] = await this.db.$transaction(
      [
        this.db.category.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.category.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data, pagination: this.page(query, total) };
  }
  async merchants(query: CatalogQuery) {
    const where = this.merchantWhere();
    const [data, total] = await this.db.$transaction(
      [
        this.db.merchant.findMany({
          where,
          select: merchantSelect,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.merchant.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data, pagination: this.page(query, total) };
  }
  private page(query: CatalogQuery, total: number) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}
