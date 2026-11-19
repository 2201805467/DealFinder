import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type {
  PrismaClient,
  Merchant,
  SyncStatus,
} from '../generated/prisma/client.js';
import type {
  ProductPage,
  ProductSearch,
  StoreProvider,
} from '../providers/store-provider.js';
import { ProviderError } from '../providers/provider-error.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import type { WorkerOptions } from '../config/worker.js';
import { ProviderRegistry } from './provider-registry.js';
import { OfferIngestionService } from './offer-ingestion.js';

const pageSchema = z.object({
  products: z.array(z.unknown()),
  total: z.number().int().nonnegative().optional(),
  totalPages: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  nextCursor: z.string().min(1).optional(),
  partial: z.boolean().optional(),
  skippedCount: z.number().int().nonnegative(),
});
const checkpointSchema = z.object({
  fingerprint: z.string(),
  pageSize: z.number().int().min(1).max(100),
  page: z.number().int().min(1).max(10000000),
  cursor: z.string().max(4096).optional(),
  offset: z.number().int().min(0).max(100),
  savedAt: z.string(),
  incomplete: z.boolean().default(false),
});
export interface SyncResult {
  merchantId: string;
  status: SyncStatus | 'SKIPPED';
  processedCount: number;
  requestCount: number;
  pageCount: number;
  skippedCount: number;
  errorCode: string | null;
  durationMs: number;
}
class StopRun extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class ProductSynchronizationService {
  private readonly ingestion: OfferIngestionService;
  constructor(
    private readonly db: PrismaClient,
    private readonly registry: ProviderRegistry,
    private readonly options: WorkerOptions,
    private readonly environment: string,
    private readonly random = Math.random,
  ) {
    this.ingestion = new OfferIngestionService(db, environment);
  }

  async runSource(
    merchantId: string,
    signal?: AbortSignal,
    force = false,
  ): Promise<SyncResult> {
    const skipped = (errorCode: string): SyncResult => ({
      merchantId,
      status: 'SKIPPED',
      processedCount: 0,
      requestCount: 0,
      pageCount: 0,
      skippedCount: 0,
      errorCode,
      durationMs: 0,
    });
    if (!this.options.enabled || signal?.aborted)
      return skipped('DISABLED_OR_STOPPED');
    // This release permits synthetic synchronization only. No hidden commercial requests.
    const merchant = await this.db.merchant.findUnique({
      where: { id: merchantId },
    });
    if (
      !merchant ||
      !merchant.enabled ||
      !merchant.syncEnabled ||
      !merchant.storageAuthorized
    )
      return skipped('SOURCE_DISABLED');
    if (!this.approved(merchant, force)) return skipped('SOURCE_NOT_APPROVED');
    const provider = this.registry.resolve(merchant);
    if (!provider) return skipped('PROVIDER_UNREGISTERED');
    try {
      return await this.db.$transaction(
        async (lock) => {
          const acquired = await lock.$queryRaw<
            { acquired: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtextextended(${'worker-sync:' + merchantId}, 0)) AS acquired`;
          if (!acquired[0]?.acquired) return skipped('SOURCE_BUSY');
          // Recheck due time under the distributed lock; separate Workers cannot both claim a due source.
          const current = await this.db.merchant.findUniqueOrThrow({
            where: { id: merchantId },
          });
          if (
            !current.enabled ||
            !current.syncEnabled ||
            !current.storageAuthorized
          )
            return skipped('SOURCE_DISABLED');
          if (!this.approved(current, force))
            return skipped('SOURCE_NOT_APPROVED');
          if (current.syncNotBefore && current.syncNotBefore > new Date())
            return skipped('RATE_LIMIT_COOLDOWN');
          if (!force && current.nextSyncAt && current.nextSyncAt > new Date())
            return skipped('NOT_DUE');
          await this.db.syncRun.updateMany({
            where: { merchantId, scope: 'SYNCHRONIZATION', status: 'RUNNING' },
            data: {
              status: 'FAILED',
              finishedAt: new Date(),
              errorCode: 'WORKER_INTERRUPTED',
              errorDetails:
                'Previous owner exited before finalizing. Existing products were preserved.',
            },
          });
          // A new generation fences any old batch whose coordinator connection died.
          // The merchant row lock serializes this claim with ingestion's policy lock.
          const claimed = await this.db.merchant.update({
            where: { id: merchantId },
            data: { syncGeneration: { increment: 1 } },
          });
          return this.execute(claimed, provider, signal, async () => {
            await lock.$queryRaw`SELECT 1`;
          });
        },
        { timeout: this.options.maxRunMs + 20000, maxWait: 2000 },
      );
    } catch {
      // Do not leak connection strings, provider URLs or errors to logs.
      logger.error('Synchronization coordinator failed', { merchantId });
      return skipped('COORDINATOR_FAILED');
    }
  }

  private approved(merchant: Merchant, force: boolean) {
    if (merchant.isSynthetic)
      return (
        ['development', 'test'].includes(this.environment) &&
        this.options.allowSynthetic &&
        merchant.sourceType === 'SYNTHETIC'
      );
    return (
      ['development', 'test', 'production'].includes(this.environment) &&
      !this.options.allowSynthetic &&
      merchant.isDataSource &&
      !!merchant.authorizationReference &&
      ((merchant.sourceType === 'CHEAPSHARK' &&
        this.options.cheapSharkEnabled &&
        force) ||
        (merchant.sourceType === 'GAMERPOWER' &&
          this.options.gamerPowerEnabled))
    );
  }

  private async execute(
    merchant: Merchant,
    provider: StoreProvider,
    externalSignal?: AbortSignal,
    coordinatorAlive?: () => Promise<void>,
  ): Promise<SyncResult> {
    const started = Date.now();
    const run = await this.db.syncRun.create({
      data: {
        merchantId: merchant.id,
        sourceType: merchant.sourceType,
        scope: 'SYNCHRONIZATION',
      },
    });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new StopRun('RUN_TIMEOUT')),
      this.options.maxRunMs,
    );
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    let status: SyncStatus = 'SUCCEEDED';
    let errorCode: string | null = null;
    let requests = 0;
    let pages = 0;
    let processed = 0;
    let skippedCount = 0;
    let retryNotBefore = 0;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          merchant.websiteUrl,
          provider.name,
          provider.checkpointVersion ?? 'unversioned',
        ]),
      )
      .digest('hex');
    const saved = checkpointSchema.safeParse(merchant.syncCheckpoint);
    const resume =
      provider.resumeAcrossRuns !== false &&
      saved.success &&
      saved.data.fingerprint === fingerprint &&
      Date.now() - Date.parse(saved.data.savedAt) < 86400000
        ? saved.data
        : undefined;
    let pageNumber = resume?.page ?? 1;
    let cursor: string | undefined = resume?.cursor;
    let offset = resume?.offset ?? 0;
    let checkpoint: Prisma.InputJsonValue | null = resume ?? null;
    const resumed = resume !== undefined;
    let coverageIncomplete = resume?.incomplete ?? false;
    const pageSize =
      resume?.pageSize ??
      Math.min(
        this.options.pageSize,
        this.options.maxProducts,
        provider.maxPageSize ?? 100,
      );
    provider.beginRun?.();
    const countRequest = async () => {
      if (requests >= this.options.maxRequests)
        throw new StopRun('REQUEST_LIMIT');
      requests++;
      await this.db.syncRun.update({
        where: { id: run.id },
        data: { requestCount: requests },
      });
    };
    const seenCursors = new Set<string>();
    try {
      while (true) {
        signal.throwIfAborted();
        await coordinatorAlive?.();
        if (pages >= this.options.maxPages) throw new StopRun('PAGE_LIMIT');
        if (processed >= this.options.maxProducts)
          throw new StopRun('PRODUCT_LIMIT');
        const remaining = this.options.maxProducts - processed;
        const search: ProductSearch = {
          pageSize,
          ...(cursor ? { cursor } : { page: pageNumber }),
        };
        let result: ProductPage | undefined;
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          if (!provider.reportsRequests && requests >= this.options.maxRequests)
            throw new StopRun('REQUEST_LIMIT');
          if (!provider.reportsRequests) await countRequest();
          try {
            result = await this.request(provider, search, signal, countRequest);
            break;
          } catch (error) {
            if (signal.aborted) throw error;
            if (
              error instanceof ProviderError &&
              error.code === 'RATE_LIMIT' &&
              error.retryAfterSeconds !== undefined &&
              Number.isFinite(error.retryAfterSeconds) &&
              error.retryAfterSeconds > 0
            ) {
              retryNotBefore = Math.max(
                retryNotBefore,
                Math.min(
                  253402300799000,
                  Date.now() + error.retryAfterSeconds * 1000,
                ),
              );
            }
            const retryable =
              error instanceof ProviderError &&
              ['NETWORK', 'TIMEOUT', 'RATE_LIMIT', 'UPSTREAM'].includes(
                error.code,
              );
            if (!retryable || attempt >= this.options.maxRetries) throw error;
            const exponential = Math.min(
              this.options.maxBackoffMs,
              this.options.backoffMs * 2 ** attempt,
            );
            const jittered = Math.floor(
              exponential / 2 + (this.random() * exponential) / 2,
            );
            const retryAfter =
              error.retryAfterSeconds === undefined
                ? 0
                : error.retryAfterSeconds * 1000;
            const delay = Math.max(jittered, retryAfter);
            // Never retry earlier than Retry-After or sleep past the run deadline.
            if (
              !Number.isFinite(delay) ||
              delay > this.options.maxRunMs - (Date.now() - started)
            )
              throw new StopRun('RETRY_AFTER_EXCEEDS_RUN');
            await sleep(delay, undefined, { signal });
          }
        }
        signal.throwIfAborted();
        await coordinatorAlive?.();
        const parsed = pageSchema.safeParse(result);
        if (!parsed.success || parsed.data.products.length > search.pageSize!)
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Provider returned an invalid or oversized page.',
          );
        if (
          parsed.data.page !== undefined &&
          !cursor &&
          parsed.data.page !== pageNumber
        )
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Provider returned a different page.',
          );
        const data = parsed.data;
        if (
          (data.total === 0 && data.products.length > 0) ||
          (data.totalPages === 0 && (data.total ?? 0) > 0)
        )
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Provider pagination metadata is inconsistent.',
          );
        coverageIncomplete ||= data.partial === true || data.skippedCount > 0;
        if (data.nextCursor && data.nextCursor === cursor)
          throw new StopRun('REPEATED_CURSOR');
        if (
          !data.products.length &&
          (data.total ?? data.totalPages) > 0 &&
          pageNumber < data.totalPages
        )
          throw new StopRun('UNEXPECTED_EMPTY_PAGE');
        if (offset > data.products.length)
          throw new StopRun('CHECKPOINT_PAGE_CHANGED');
        const accepted = result!.products.slice(offset, offset + remaining);
        const consumed = offset + accepted.length;
        const pageFinished = consumed >= data.products.length;
        const complete =
          pageFinished &&
          !data.nextCursor &&
          (cursor !== undefined ||
            pageNumber >= data.totalPages ||
            data.total === 0);
        checkpoint = complete
          ? null
          : {
              fingerprint,
              pageSize,
              page: pageFinished
                ? data.nextCursor
                  ? pageNumber
                  : pageNumber + 1
                : pageNumber,
              ...(pageFinished
                ? data.nextCursor
                  ? { cursor: data.nextCursor }
                  : {}
                : cursor
                  ? { cursor }
                  : {}),
              offset: pageFinished ? 0 : consumed,
              savedAt: new Date().toISOString(),
              incomplete: coverageIncomplete,
            };
        if (data.products.length) {
          if (accepted.length)
            await this.ingestion.ingest(
              merchant.id,
              await this.ingestionItems(accepted),
              {
                syncRunId: run.id,
                signal,
                syntheticOnly: merchant.isSynthetic,
                checkpoint,
                generation: merchant.syncGeneration,
              },
            );
          processed += accepted.length;
        } else {
          const updated = await this.db.merchant.updateMany({
            where: { id: merchant.id, syncGeneration: merchant.syncGeneration },
            data: { syncCheckpoint: checkpoint ?? Prisma.DbNull },
          });
          if (updated.count !== 1) throw new StopRun('COORDINATOR_LOST');
        }
        pages++;
        skippedCount += data.skippedCount;
        await this.db.syncRun.update({
          where: { id: run.id },
          data: { pageCount: pages, skippedCount },
        });
        if (!pageFinished) throw new StopRun('PRODUCT_LIMIT');
        if (data.partial || data.skippedCount > 0)
          throw new StopRun('PARTIAL_RESPONSE');
        if (data.nextCursor) {
          if (seenCursors.has(data.nextCursor))
            throw new StopRun('REPEATED_CURSOR');
          seenCursors.add(data.nextCursor);
          cursor = data.nextCursor;
        } else if (complete) {
          if (coverageIncomplete) throw new StopRun('INCOMPLETE_CYCLE');
          if (resumed && !provider.stablePagination)
            throw new StopRun('UNSTABLE_PAGINATION');
          break;
        } else {
          if (data.products.length === 0)
            throw new StopRun('UNEXPECTED_EMPTY_PAGE');
          pageNumber++;
        }
        offset = 0;
      }
    } catch (error) {
      status = externalSignal?.aborted
        ? 'CANCELLED'
        : processed > 0
          ? 'PARTIAL'
          : 'FAILED';
      errorCode = signal.aborted
        ? externalSignal?.aborted
          ? 'SHUTDOWN'
          : 'RUN_TIMEOUT'
        : error instanceof StopRun
          ? error.code
          : error instanceof ProviderError || error instanceof AppError
            ? error.code
            : 'SYNC_FAILED';
    } finally {
      clearTimeout(timer);
    }
    const durationMs = Date.now() - started;
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchant.id}::uuid FOR UPDATE`;
      const owner = await tx.merchant.findUniqueOrThrow({
        where: { id: merchant.id },
      });
      const owns = owner.syncGeneration === merchant.syncGeneration;
      if (!owns) {
        status = processed > 0 ? 'PARTIAL' : 'FAILED';
        errorCode = 'COORDINATOR_LOST';
      }
      await tx.syncRun.updateMany({
        where: { id: run.id, status: 'RUNNING' },
        data: {
          status,
          finishedAt: new Date(),
          processedCount: processed,
          requestCount: requests,
          pageCount: pages,
          skippedCount,
          durationMs,
          errorCode,
          errorDetails: errorCode
            ? 'Synchronization ended with incomplete coverage. Previously stored products were preserved.'
            : null,
        },
      });
      if (owns)
        await tx.merchant.update({
          where: { id: merchant.id },
          data: {
            ...(provider.resumeAcrossRuns === false && {
              syncCheckpoint: Prisma.DbNull,
            }),
            nextSyncAt: new Date(
              Math.max(
                retryNotBefore,
                Date.now() +
                  (provider.resumeAcrossRuns !== false &&
                  checkpoint &&
                  ['PAGE_LIMIT', 'PRODUCT_LIMIT', 'REQUEST_LIMIT'].includes(
                    errorCode ?? '',
                  )
                    ? this.options.pollMs
                    : merchant.syncIntervalSeconds * 1000),
              ),
            ),
            syncNotBefore:
              retryNotBefore > Date.now() ? new Date(retryNotBefore) : null,
          },
        });
    });
    const outcome = {
      merchantId: merchant.id,
      status,
      processedCount: processed,
      requestCount: requests,
      pageCount: pages,
      skippedCount,
      errorCode,
      durationMs,
    };
    logger.info('Synchronization finished', {
      ...outcome,
      errorCode: errorCode ?? '',
    });
    return outcome;
  }

  private async ingestionItems(products: ProductPage['products']) {
    return Promise.all(
      products.map(async (product) => {
        if (!product.source) return { product };
        const slug =
          product.source.key === 'CHEAPSHARK'
            ? 'pc-games'
            : product.source.kind === 'dlc'
              ? 'dlc'
              : product.source.kind === 'game'
                ? 'free-games'
                : 'giveaways';
        const category = await this.db.category.findUnique({ where: { slug } });
        return {
          product,
          ...(category && !category.isSynthetic && { categoryId: category.id }),
        };
      }),
    );
  }

  private async request(
    provider: StoreProvider,
    search: ProductSearch,
    signal: AbortSignal,
    onRequest: () => Promise<void>,
  ): Promise<ProductPage> {
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(),
      this.options.requestTimeoutMs,
    );
    const combined = AbortSignal.any([signal, timeoutController.signal]);
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        provider.searchProducts(search, { signal: combined, onRequest }),
        new Promise<never>((_resolve, reject) => {
          onAbort = () =>
            reject(
              new ProviderError(
                'TIMEOUT',
                'Provider request cancelled or timed out.',
              ),
            );
          if (combined.aborted) onAbort();
          else combined.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) combined.removeEventListener('abort', onAbort);
    }
  }
}
