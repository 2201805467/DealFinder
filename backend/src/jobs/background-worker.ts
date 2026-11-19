import { setTimeout as sleep } from 'node:timers/promises';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { WorkerOptions } from '../config/worker.js';
import {
  assertDemoWorkerEnabled,
  assertRealWorkerEnabled,
} from '../config/worker.js';
import {
  ProductSynchronizationService,
  type SyncResult,
} from '../services/product-synchronization.js';
import { OfferIngestionService } from '../services/offer-ingestion.js';
import { logger } from '../utils/logger.js';

export class BackgroundWorker {
  private lastCleanup = 0;
  constructor(
    private readonly db: PrismaClient,
    private readonly synchronization: ProductSynchronizationService,
    private readonly options: WorkerOptions,
    private readonly environment: string,
    private readonly mode: 'demo' | 'real' = 'demo',
  ) {}

  async tick(
    signal: AbortSignal,
    force = false,
    performCleanup = true,
  ): Promise<SyncResult[]> {
    this.assertEnabled();
    const merchants = await this.db.merchant.findMany({
      where: {
        enabled: true,
        syncEnabled: true,
        storageAuthorized: true,
        ...(this.mode === 'demo'
          ? { isSynthetic: true, sourceType: 'SYNTHETIC' as const }
          : {
              isSynthetic: false,
              isDataSource: true,
              sourceType: {
                in: [
                  ...(this.options.gamerPowerEnabled
                    ? ['GAMERPOWER' as const]
                    : []),
                  ...(force && this.options.cheapSharkEnabled
                    ? ['CHEAPSHARK' as const]
                    : []),
                ],
              },
            }),
      },
      orderBy: { id: 'asc' },
    });
    const results: SyncResult[] = [];
    for (const merchant of merchants) {
      if (signal.aborted) break;
      try {
        results.push(
          await this.synchronization.runSource(merchant.id, signal, force),
        );
      } catch {
        logger.error(
          'Source synchronization failed; continuing with other sources',
          { merchantId: merchant.id },
        );
      }
    }
    if (performCleanup) await this.cleanup(signal);
    return results;
  }

  private assertEnabled() {
    if (this.mode === 'real')
      assertRealWorkerEnabled(this.environment, this.options);
    else assertDemoWorkerEnabled(this.environment, this.options);
  }

  private async cleanup(signal: AbortSignal) {
    if (
      !signal.aborted &&
      Date.now() - this.lastCleanup >= this.options.cleanupMs
    ) {
      try {
        await this.db.$transaction(
          async (lock) => {
            const rows = await lock.$queryRaw<
              { acquired: boolean }[]
            >`SELECT pg_try_advisory_xact_lock(hashtextextended('worker-expiry-cleanup', 0)) AS acquired`;
            if (rows[0]?.acquired) {
              const counts = await new OfferIngestionService(
                this.db,
                this.environment,
              ).purgeExpired();
              logger.info('Expired content cleanup finished', counts);
            }
          },
          { timeout: 20000 },
        );
        this.lastCleanup = Date.now();
      } catch {
        logger.error(
          'Expired content cleanup failed; will retry on a later tick',
        );
      }
    }
  }

  async start(signal: AbortSignal) {
    this.assertEnabled();
    const pause = async (ms: number) => {
      try {
        await sleep(ms, undefined, { signal });
      } catch {
        if (!signal.aborted) throw new Error('Worker polling interrupted.');
      }
    };
    // Separate asynchronous loops: retention work never waits for a slow source.
    const synchronize = async () => {
      while (!signal.aborted) {
        try {
          await this.tick(signal, false, false);
        } catch {
          logger.error('Worker tick failed; will retry after poll interval');
        }
        await pause(this.options.pollMs);
      }
    };
    const clean = async () => {
      while (!signal.aborted) {
        await this.cleanup(signal);
        await pause(this.options.cleanupMs);
      }
    };
    await Promise.all([synchronize(), clean()]);
  }
}
