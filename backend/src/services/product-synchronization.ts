import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
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
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  nextCursor: z.string().min(1).optional(),
  partial: z.boolean().optional(),
  skippedCount: z.number().int().nonnegative(),
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
    if (
      this.environment === 'production' ||
      !['development', 'test'].includes(this.environment) ||
      !this.options.allowSynthetic ||
      !merchant.isSynthetic ||
      merchant.sourceType !== 'SYNTHETIC'
    )
      return skipped('SOURCE_NOT_APPROVED');
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
          if (!current.isSynthetic || current.sourceType !== 'SYNTHETIC')
            return skipped('SOURCE_NOT_APPROVED');
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
          return this.execute(current, provider, signal);
        },
        { timeout: this.options.maxRunMs + 20000, maxWait: 2000 },
      );
    } catch {
      // Do not leak connection strings, provider URLs or errors to logs.
      logger.error('Synchronization coordinator failed', { merchantId });
      return skipped('COORDINATOR_FAILED');
    }
  }

  private async execute(
    merchant: Merchant,
    provider: StoreProvider,
    externalSignal?: AbortSignal,
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
    let pageNumber = 1;
    let cursor: string | undefined;
    const pageSize = Math.min(this.options.pageSize, this.options.maxProducts);
    const seenCursors = new Set<string>();
    try {
      while (true) {
        signal.throwIfAborted();
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
          if (requests >= this.options.maxRequests)
            throw new StopRun('REQUEST_LIMIT');
          requests++;
          await this.db.syncRun.update({
            where: { id: run.id },
            data: { requestCount: requests },
          });
          try {
            result = await this.request(provider, search, signal);
            break;
          } catch (error) {
            if (signal.aborted) throw error;
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
        if (data.products.length) {
          const accepted = result!.products.slice(0, remaining);
          await this.ingestion.ingest(
            merchant.id,
            accepted.map((product) => ({ product })),
            { syncRunId: run.id, signal, syntheticOnly: true },
          );
          processed += accepted.length;
        }
        pages++;
        skippedCount += data.skippedCount;
        await this.db.syncRun.update({
          where: { id: run.id },
          data: { pageCount: pages, skippedCount },
        });
        if (data.products.length > remaining)
          throw new StopRun('PRODUCT_LIMIT');
        if (data.partial || data.skippedCount > 0)
          throw new StopRun('PARTIAL_RESPONSE');
        if (data.nextCursor) {
          if (seenCursors.has(data.nextCursor))
            throw new StopRun('REPEATED_CURSOR');
          seenCursors.add(data.nextCursor);
          cursor = data.nextCursor;
        } else if (cursor || pageNumber >= data.totalPages || data.total === 0)
          break;
        else {
          if (data.products.length === 0)
            throw new StopRun('UNEXPECTED_EMPTY_PAGE');
          pageNumber++;
        }
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
    await this.db.$transaction([
      this.db.syncRun.update({
        where: { id: run.id },
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
      }),
      this.db.merchant.update({
        where: { id: merchant.id },
        data: {
          nextSyncAt: new Date(
            Date.now() + merchant.syncIntervalSeconds * 1000,
          ),
        },
      }),
    ]);
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

  private async request(
    provider: StoreProvider,
    search: ProductSearch,
    signal: AbortSignal,
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
        provider.searchProducts(search, { signal: combined }),
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
