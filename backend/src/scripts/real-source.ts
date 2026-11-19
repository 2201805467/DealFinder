import 'dotenv/config';
import { parseArgs } from 'node:util';
import { CheapSharkProvider } from '../providers/cheapshark/cheapshark-provider.js';
import { GamerPowerProvider } from '../providers/gamerpower/gamerpower-provider.js';
import { ProviderError } from '../providers/provider-error.js';
import { createDatabaseClient } from '../database/client.js';
import {
  parseWorkerEnvironment,
  assertRealWorkerEnabled,
} from '../config/worker.js';
import { ProductSynchronizationService } from '../services/product-synchronization.js';
import { realRegistry } from '../services/provider-registry.js';
import { prepareRealSource } from '../services/real-sources.js';
import { calculatedDiscount, exactMoney } from '../services/money.js';
class CommandError extends Error {}

try {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      limit: { type: 'string', default: '20' },
      query: { type: 'string' },
      sync: { type: 'boolean', default: false },
      confirm: { type: 'boolean', default: false },
    },
  });
  const key = values.source;
  const limit = Number(values.limit);
  if (
    !['cheapshark', 'gamerpower'].includes(key ?? '') ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 60 ||
    !values.confirm
  )
    throw new CommandError(
      'Use --source cheapshark|gamerpower --limit 1..60 --confirm [--sync]. Explicit live network opt-in required.',
    );
  const source = key as 'cheapshark' | 'gamerpower';
  console.log(
    `REAL API DATA: ${source}. No synthetic fixtures. ${values.sync ? 'Bounded database synchronization.' : 'Read-only sample; no database write.'}`,
  );
  if (!values.sync) {
    const provider =
      source === 'cheapshark'
        ? new CheapSharkProvider()
        : new GamerPowerProvider();
    const page = await provider.searchProducts({
      page: 1,
      pageSize: limit,
      ...(values.query && { query: values.query }),
    });
    console.table(
      page.products.map((p) => ({
        name: p.name,
        retailer: p.store,
        price:
          p.currentPrice === 0 ? 'Free' : String(p.currentPrice ?? 'unknown'),
        reference: p.source?.referencePriceTrusted
          ? String(p.originalPrice ?? '')
          : '',
        discount: p.source?.referencePriceTrusted
          ? calculatedDiscount(
              exactMoney(p.currentPrice),
              exactMoney(p.originalPrice),
            )?.toFixed()
          : '',
        currency: p.currency,
        url: p.productUrl,
      })),
    );
    console.log(
      JSON.stringify({
        fetched: page.products.length,
        total: page.total ?? null,
        totalPages: page.totalPages,
        skipped: page.skippedCount,
      }),
    );
  } else {
    if (values.query)
      throw new CommandError('Query is supported in read-only samples only.');
    const options = parseWorkerEnvironment({
      ...process.env,
      WORKER_ENABLED: 'true',
      WORKER_ALLOW_SYNTHETIC: 'false',
      CHEAPSHARK_ENABLED: source === 'cheapshark' ? 'true' : 'false',
      GAMERPOWER_ENABLED: source === 'gamerpower' ? 'true' : 'false',
      WORKER_MAX_PRODUCTS: String(limit),
      WORKER_PAGE_SIZE: String(limit),
      WORKER_MAX_PAGES: '1',
      WORKER_MAX_REQUESTS: '6',
      WORKER_MAX_RETRIES: '2',
    });
    assertRealWorkerEnabled(process.env.NODE_ENV ?? 'development', options);
    const db = createDatabaseClient(process.env.DATABASE_URL ?? '');
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const merchant = await prepareRealSource(db, source);
      const result = await new ProductSynchronizationService(
        db,
        realRegistry(),
        options,
        process.env.NODE_ENV ?? 'development',
      ).runSource(merchant.id, controller.signal, true);
      console.log(JSON.stringify(result));
      // A deliberately bounded sample does not claim complete catalogue coverage.
      if (
        result.status !== 'SUCCEEDED' &&
        !(
          result.status === 'PARTIAL' &&
          ['PRODUCT_LIMIT', 'PAGE_LIMIT'].includes(result.errorCode ?? '')
        )
      )
        process.exitCode = 1;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      await db.$disconnect();
    }
  }
} catch (error) {
  console.error(
    error instanceof ProviderError
      ? `Live source failed: ${error.code}`
      : error instanceof CommandError
        ? error.message
        : 'Live source failed. Check configuration.',
  );
  process.exitCode = 1;
}
