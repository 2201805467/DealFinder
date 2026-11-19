import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { StoreProduct } from '../providers/store-provider.js';
import { AppError } from '../utils/app-error.js';
import { calculatedDiscount, exactMoney } from './money.js';
import { sourceMetadataSchema } from '../providers/source-metadata.js';

const httpUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
const inputSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  store: z.string().min(1),
  name: z.string().trim().min(1).max(500),
  description: z.string().max(20000).optional(),
  imageUrl: httpUrl.optional(),
  productUrl: httpUrl.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  market: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  fetchedAt: z.iso.datetime({ offset: true }),
  currentPrice: z.number().finite().nonnegative().optional(),
  originalPrice: z.number().finite().nonnegative().optional(),
  priceRestricted: z.boolean().optional(),
  discountPercentage: z.number().optional(),
  source: sourceMetadataSchema.optional(),
});
export interface IngestionItem {
  product: StoreProduct;
  variantKey?: string;
  affiliateUrl?: string;
  categoryId?: string;
  // Explicit, verified association only. Names never imply product identity.
  productId?: string;
  referencePriceTrusted?: boolean;
  shippingCost?: string;
}
const optionsSchema = z.object({
  variantKey: z.string().max(200).optional(),
  affiliateUrl: httpUrl.optional(),
  categoryId: z.uuid().optional(),
  productId: z.uuid().optional(),
  referencePriceTrusted: z.boolean().optional(),
  shippingCost: z.string().optional(),
});

export class OfferIngestionService {
  constructor(
    private readonly db: PrismaClient,
    private readonly environment: string,
  ) {}

  async ingest(
    merchantId: string,
    items: IngestionItem[],
    context?: {
      syncRunId: string;
      signal?: AbortSignal;
      syntheticOnly?: boolean;
      checkpoint?: Prisma.InputJsonValue | null;
      generation?: number;
    },
  ) {
    context?.signal?.throwIfAborted();
    if (
      !z.uuid().safeParse(merchantId).success ||
      items.length < 1 ||
      items.length > 100
    )
      throw new AppError(
        400,
        'INVALID_INPUT',
        'Provide a merchant and 1..100 normalized products.',
      );
    const inputs = items
      .map((item) => {
        const parsed = inputSchema.safeParse(item.product);
        const options = optionsSchema.safeParse(item);
        if (!parsed.success || !options.success)
          throw new AppError(
            400,
            'INVALID_INPUT',
            'Normalized product or association is invalid.',
          );
        const product = parsed.data;
        const current = product.priceRestricted
          ? null
          : exactMoney(product.currentPrice);
        const reference = product.priceRestricted
          ? null
          : exactMoney(product.originalPrice);
        if (!product.currency && (current !== null || reference !== null))
          throw new AppError(
            400,
            'CURRENCY_REQUIRED',
            'A price requires an explicit source currency.',
          );
        if (current !== null && reference !== null && reference.lt(current))
          throw new AppError(
            400,
            'INVALID_PRICE',
            'Reference price must not be lower than current price.',
          );
        const date = new Date(product.fetchedAt);
        const shippingCost = exactMoney(options.data.shippingCost);
        if (shippingCost !== null && !product.currency)
          throw new AppError(
            400,
            'CURRENCY_REQUIRED',
            'Shipping requires the offer currency.',
          );
        if (date.getTime() > Date.now() + 60000)
          throw new AppError(
            400,
            'INVALID_TIMESTAMP',
            'Retrieval time cannot be in the future.',
          );
        return {
          product,
          options: options.data,
          current,
          reference,
          date,
          shippingCost,
        };
      })
      .sort((a, b) =>
        JSON.stringify([
          a.product.externalId,
          a.product.market ?? '',
          a.options.variantKey ?? '',
          a.product.currency ?? '',
        ]).localeCompare(
          JSON.stringify([
            b.product.externalId,
            b.product.market ?? '',
            b.options.variantKey ?? '',
            b.product.currency ?? '',
          ]),
        ),
      );

    const run = await this.db.merchant.findUnique({
      where: { id: merchantId },
    });
    if (
      !run ||
      !run.enabled ||
      !run.storageAuthorized ||
      (!run.isSynthetic && !run.authorizationReference?.trim()) ||
      (run.retentionSeconds === null && !run.allowIndefiniteRetention) ||
      (run.retentionSeconds !== null && run.retentionSeconds <= 0) ||
      (run.isSynthetic && this.environment === 'production') ||
      (context && !run.syncEnabled) ||
      (context?.syntheticOnly &&
        (!run.isSynthetic || run.sourceType !== 'SYNTHETIC'))
    )
      throw new AppError(
        403,
        'STORAGE_NOT_AUTHORIZED',
        'Merchant storage policy does not permit this ingestion.',
      );
    const sync = context
      ? await this.db.syncRun.findFirst({
          where: {
            id: context.syncRunId,
            merchantId,
            scope: 'SYNCHRONIZATION',
            status: 'RUNNING',
          },
        })
      : await this.db.syncRun.create({
          data: { merchantId, sourceType: run.sourceType },
        });
    if (!sync)
      throw new AppError(
        400,
        'INVALID_SYNC_RUN',
        'Synchronization run is not active for this merchant.',
      );
    try {
      const result = await this.db.$transaction(
        async (tx) => {
          // Keep policy stable during this batch; a concurrent revocation must wait
          // for the transaction or be observed before storing provider content.
          await tx.$executeRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR SHARE`;
          const currentPolicy = await tx.merchant.findUnique({
            where: { id: merchantId },
          });
          if (
            !currentPolicy ||
            !currentPolicy.enabled ||
            !currentPolicy.storageAuthorized ||
            (context?.generation !== undefined &&
              currentPolicy.syncGeneration !== context.generation) ||
            currentPolicy.retentionSeconds !== run.retentionSeconds ||
            currentPolicy.allowIndefiniteRetention !==
              run.allowIndefiniteRetention ||
            currentPolicy.authorizationReference !==
              run.authorizationReference ||
            currentPolicy.isSynthetic !== run.isSynthetic ||
            currentPolicy.sourceType !== run.sourceType ||
            currentPolicy.isDataSource !== run.isDataSource ||
            currentPolicy.dataSourceId !== run.dataSourceId ||
            currentPolicy.staleAfterSeconds !== run.staleAfterSeconds ||
            (context && !currentPolicy.syncEnabled)
          ) {
            throw new AppError(
              409,
              'POLICY_CHANGED',
              'Merchant policy changed; validate permission again before ingestion.',
            );
          }
          const ids: string[] = [];
          for (const entry of inputs) {
            context?.signal?.throwIfAborted();
            const { product, options, current, reference, date, shippingCost } =
              entry;
            const source = product.source;
            if (
              source &&
              (!run.isDataSource ||
                run.isSynthetic ||
                source.key !== run.sourceType ||
                options.affiliateUrl ||
                options.productId)
            )
              throw new AppError(
                400,
                'SOURCE_MISMATCH',
                'Aggregator metadata requires a reviewed source and official links.',
              );
            if (run.isDataSource && !source)
              throw new AppError(
                400,
                'SOURCE_MISMATCH',
                'Aggregator attribution is required.',
              );
            if (!source && product.store !== run.name)
              throw new AppError(
                400,
                'SOURCE_MISMATCH',
                'Product store must match the registered merchant.',
              );
            let expiresAt =
              run.retentionSeconds === null
                ? null
                : new Date(date.getTime() + run.retentionSeconds * 1000);
            if (
              source?.endsAt &&
              (!expiresAt || new Date(source.endsAt) < expiresAt)
            )
              expiresAt = new Date(source.endsAt);
            if (expiresAt && expiresAt <= new Date())
              throw new AppError(
                400,
                'EXPIRED_INPUT',
                'Source content has already expired.',
              );
            const retailer = source
              ? await tx.merchant.upsert({
                  where: {
                    dataSourceId_externalStoreId: {
                      dataSourceId: merchantId,
                      externalStoreId: source.retailerId,
                    },
                  },
                  create: {
                    name: product.store,
                    sourceType: run.sourceType,
                    dataSourceId: merchantId,
                    externalStoreId: source.retailerId,
                    websiteUrl: null,
                    enabled: true,
                    storageAuthorized: true,
                    authorizationReference: run.authorizationReference,
                    retentionSeconds: run.retentionSeconds,
                    staleAfterSeconds: run.staleAfterSeconds,
                  },
                  update: { name: product.store },
                })
              : undefined;
            if (
              retailer &&
              (!retailer.enabled ||
                !retailer.storageAuthorized ||
                retailer.isSynthetic ||
                retailer.isDataSource ||
                retailer.sourceType !== run.sourceType)
            )
              throw new AppError(
                403,
                'STORAGE_NOT_AUTHORIZED',
                'Retailer permission has been revoked.',
              );
            const identity = {
              merchantId: retailer?.id ?? merchantId,
              externalProductId: product.externalId,
              market: product.market ?? '',
              variantKey: options.variantKey ?? '',
              currency: product.currency ?? '',
            };
            // Same source + official game ID is evidence of identity across its retailers.
            // Names and identifiers from different sources never trigger a merge.
            if (source?.key === 'CHEAPSHARK')
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'source-game:' + merchantId + ':' + product.externalId}, 0))`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))`;
            const existing = await tx.offer.findUnique({
              where: { sourceIdentity: identity },
            });
            if (existing && existing.lastUpdatedAt > date) {
              ids.push(existing.id);
              continue;
            }
            if (
              existing &&
              options.productId &&
              existing.productId !== options.productId
            )
              throw new AppError(
                409,
                'ASSOCIATION_CONFLICT',
                'An existing source offer cannot be silently reassigned.',
              );
            let target = options.productId ?? existing?.productId;
            if (!target && source?.key === 'CHEAPSHARK')
              target = (
                await tx.product.findFirst({
                  where: {
                    contentMerchantId: merchantId,
                    contentExternalId: product.externalId,
                    isSynthetic: false,
                  },
                  orderBy: { createdAt: 'asc' },
                })
              )?.id;
            if (target) {
              const linked = await tx.product.findUnique({
                where: { id: target },
              });
              if (!linked || linked.isSynthetic !== run.isSynthetic)
                throw new AppError(
                  400,
                  'INVALID_ASSOCIATION',
                  'Product association must exist with matching data provenance.',
                );
              if (
                linked.contentMerchantId === merchantId &&
                linked.contentExternalId === product.externalId
              ) {
                await tx.product.update({
                  where: { id: target },
                  data: {
                    name: product.name,
                    description: product.description ?? null,
                    imageUrl: product.imageUrl ?? null,
                    expiresAt,
                    ...(options.categoryId && {
                      categoryId: options.categoryId,
                    }),
                  },
                });
              }
            } else {
              target = (
                await tx.product.create({
                  data: {
                    name: product.name,
                    description: product.description ?? null,
                    imageUrl: product.imageUrl ?? null,
                    categoryId: options.categoryId ?? null,
                    contentMerchantId: merchantId,
                    contentExternalId: product.externalId,
                    isSynthetic: run.isSynthetic,
                    expiresAt,
                  },
                })
              ).id;
            }
            // Synthetic references are controlled test fixtures, not commercial evidence.
            const referencePriceTrusted =
              source?.referencePriceTrusted ??
              options.referencePriceTrusted ??
              run.isSynthetic;
            const data = {
              currentPrice: current,
              referencePrice: reference,
              discountPercentage: referencePriceTrusted
                ? calculatedDiscount(current, reference)
                : null,
              referencePriceTrusted,
              shippingCost,
              staleAt: new Date(date.getTime() + run.staleAfterSeconds * 1000),
              productUrl: product.productUrl ?? null,
              affiliateUrl: options.affiliateUrl ?? null,
              sourceMetadata: source ? { ...source } : Prisma.DbNull,
              availability:
                product.availability === 'available'
                  ? ('AVAILABLE' as const)
                  : product.availability === 'unavailable'
                    ? ('UNAVAILABLE' as const)
                    : ('UNKNOWN' as const),
              lastUpdatedAt: date,
              expiresAt,
              isSynthetic: run.isSynthetic,
            };
            const saved = await tx.offer.upsert({
              where: { sourceIdentity: identity },
              create: { ...identity, ...data, productId: target },
              update: data,
            });
            ids.push(saved.id);
          }
          context?.signal?.throwIfAborted();
          if (context && context.checkpoint !== undefined) {
            await tx.merchant.update({
              where: { id: merchantId },
              data: { syncCheckpoint: context.checkpoint ?? Prisma.DbNull },
            });
          }
          await tx.syncRun.update({
            where: { id: sync.id },
            data: context
              ? { processedCount: { increment: inputs.length } }
              : {
                  status: 'SUCCEEDED',
                  finishedAt: new Date(),
                  processedCount: inputs.length,
                },
          });
          return { syncRunId: sync.id, offerIds: ids };
        },
        { timeout: 15000 },
      );
      return result;
    } catch (error) {
      const safeCode =
        error instanceof AppError ? error.code : 'INGESTION_FAILED';
      if (!context)
        await this.db.syncRun.update({
          where: { id: sync.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorCode: safeCode,
            errorDetails:
              'Batch rolled back. No upstream payload or credentials retained.',
          },
        });
      if (error instanceof AppError) throw error;
      throw new AppError(
        500,
        'INGESTION_FAILED',
        'Product batch could not be stored.',
      );
    }
  }

  // Explicit maintenance, never scheduled. Removes expired provider content, not price history.
  async purgeExpired(now = new Date()) {
    return this.db.$transaction(async (tx) => {
      const offers = await tx.offer.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      // Erase expired licensed text/images even if another merchant still has an
      // offer linked to this product. Do not cascade-delete that valid offer.
      const redacted = await tx.product.updateMany({
        where: { expiresAt: { lte: now } },
        data: {
          name: '[Expired source content]',
          description: null,
          imageUrl: null,
        },
      });
      const products = await tx.product.deleteMany({
        where: { expiresAt: { lte: now }, offers: { none: {} } },
      });
      return {
        offers: offers.count,
        products: products.count,
        redactedProducts: redacted.count,
      };
    });
  }
}
