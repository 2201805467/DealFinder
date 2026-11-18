import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { createDatabaseClient } from '../../src/database/client.js';
import { assertTestDatabase } from '../../src/database/development-guard.js';
import { parseWorkerEnvironment } from '../../src/config/worker.js';
import { ProviderRegistry } from '../../src/services/provider-registry.js';
import { ProductSynchronizationService } from '../../src/services/product-synchronization.js';
import { OfferIngestionService } from '../../src/services/offer-ingestion.js';
import { CatalogService } from '../../src/services/catalog.js';
import { BackgroundWorker } from '../../src/jobs/background-worker.js';
import {
  evaluateDeal,
  dealScoreSql,
  defaultScoringRules,
} from '../../src/scoring/deal-scoring.js';
import { Prisma, type Merchant } from '../../src/generated/prisma/client.js';
import { createApp } from '../../src/app.js';
import type {
  ProductPage,
  StoreProvider,
  StoreProduct,
} from '../../src/providers/store-provider.js';
import { MockStoreProvider } from '../../src/providers/mock-store-provider.js';
import { ProviderError } from '../../src/providers/provider-error.js';

if (process.env.CATALOG_INTEGRATION !== '1')
  throw new Error('Use the integration runner.');
assertTestDatabase(
  process.env.DATABASE_URL,
  'postgresql://localhost/dealfinder',
);
const db = createDatabaseClient(process.env.DATABASE_URL!);
const options = parseWorkerEnvironment({
  WORKER_ENABLED: 'true',
  WORKER_ALLOW_SYNTHETIC: 'true',
  WORKER_PAGE_SIZE: '2',
  WORKER_BACKOFF_MS: '5',
  WORKER_MAX_BACKOFF_MS: '20',
  WORKER_MAX_RUN_MS: '3000',
  WORKER_REQUEST_TIMEOUT_MS: '100',
  WORKER_MAX_RETRIES: '2',
});
const merchants: Merchant[] = [];
const prefix = 'SYNCHRONIZATION TEST ' + randomUUID();
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let root: string;
function page(
  products: StoreProduct[],
  pageNumber = 1,
  totalPages = 1,
): ProductPage {
  return {
    products,
    page: pageNumber,
    total: totalPages * 2,
    totalPages,
    skippedCount: 0,
  };
}
function product(
  m: Merchant,
  externalId = 'fixture',
  change: Partial<StoreProduct> = {},
): StoreProduct {
  return {
    externalId,
    store: m.name,
    name: prefix + ' ' + externalId,
    currentPrice: 50,
    originalPrice: 100,
    currency: 'USD',
    market: 'US',
    availability: 'available',
    fetchedAt: new Date().toISOString(),
    productUrl: 'https://fixture.example.invalid/product',
    ...change,
  };
}
async function merchant() {
  const m = await db.merchant.create({
    data: {
      name: prefix + ' ' + merchants.length,
      websiteUrl: `https://${randomUUID()}.example.invalid`,
      sourceType: 'SYNTHETIC',
      isSynthetic: true,
      enabled: true,
      storageAuthorized: true,
      retentionSeconds: 86400,
      syncEnabled: true,
      syncIntervalSeconds: 60,
      staleAfterSeconds: 600,
    },
  });
  merchants.push(m);
  return m;
}
function service(
  provider: StoreProvider,
  overrides: Partial<typeof options> = {},
  database = db,
  environment = 'test',
) {
  return new ProductSynchronizationService(
    database,
    new ProviderRegistry([
      { sourceType: 'SYNTHETIC', synthetic: true, create: () => provider },
    ]),
    { ...options, ...overrides },
    environment,
    () => 0,
  );
}
function fake(
  name: string,
  fn: StoreProvider['searchProducts'],
): StoreProvider {
  return { name, searchProducts: fn };
}

before(async () => {
  server = createApp({ CORS_ORIGINS: [] }, new CatalogService(db, true)).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const ids = merchants.map((m) => m.id);
  await db.offer.deleteMany({ where: { merchantId: { in: ids } } });
  await db.product.deleteMany({ where: { contentMerchantId: { in: ids } } });
  await db.syncRun.deleteMany({ where: { merchantId: { in: ids } } });
  await db.merchant.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test('one and multiple pages flow through existing Upsert into REST API', async () => {
  for (const pageSize of [20, 2]) {
    const m = await merchant();
    const result = await service(new MockStoreProvider(m.name), {
      pageSize,
    }).runSource(m.id, undefined, true);
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.processedCount, 5);
    assert.equal(result.pageCount, pageSize === 20 ? 1 : 3);
    const runs = await db.syncRun.findMany({ where: { merchantId: m.id } });
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.processedCount, 5);
    const response = await fetch(
      `${root}/deals?merchantId=${m.id}&sort=score_desc`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.data.length, 4);
    assert.ok(
      body.data.every(
        (row: any) => row.isSynthetic && typeof row.dealScore === 'string',
      ),
    );
  }
});
test('repeated synchronization updates prices/availability without duplicate products or offers', async () => {
  const m = await merchant();
  let price = 50;
  let available = true;
  const provider = fake(m.name, async () =>
    page([
      product(m, 'upsert', {
        currentPrice: price,
        availability: available ? 'available' : 'unavailable',
      }),
    ]),
  );
  const sync = service(provider);
  await sync.runSource(m.id, undefined, true);
  price = 40;
  available = false;
  await sync.runSource(m.id, undefined, true);
  const rows = await db.offer.findMany({ where: { merchantId: m.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.currentPrice?.toFixed(), '40');
  assert.equal(rows[0]?.availability, 'UNAVAILABLE');
  assert.equal(
    await db.product.count({ where: { contentMerchantId: m.id } }),
    1,
  );
});
test('temporary API errors retry with backoff and do not duplicate data', async () => {
  const m = await merchant();
  let calls = 0;
  const result = await service(
    fake(m.name, async () => {
      if (calls++ === 0)
        throw new ProviderError('NETWORK', 'synthetic failure');
      return page([product(m)]);
    }),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.requestCount, 2);
  assert.equal(await db.offer.count({ where: { merchantId: m.id } }), 1);
});
test('timeouts abort requests, retry within budget, and never write late provider results', async () => {
  const m = await merchant();
  let calls = 0;
  let aborted = false;
  const result = await service(
    fake(m.name, async (_search, context) => {
      if (calls++ === 0)
        return new Promise<ProductPage>((resolve) => {
          context?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              setTimeout(() => resolve(page([product(m, 'late')])), 10);
            },
            { once: true },
          );
        });
      return page([product(m, 'current')]);
    }),
    { requestTimeoutMs: 30 },
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.ok(aborted);
  await sleep(30);
  assert.equal(
    await db.offer.count({
      where: { merchantId: m.id, externalProductId: 'late' },
    }),
    0,
  );
  assert.equal(result.requestCount, 2);
});
test('429 respects Retry-After; long waits stop safely rather than bypassing the limit', async () => {
  const m = await merchant();
  let calls = 0;
  const started = Date.now();
  const result = await service(
    fake(m.name, async () => {
      if (calls++ === 0) throw new ProviderError('RATE_LIMIT', 'fixture', 0.03);
      return page([product(m)]);
    }),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.ok(Date.now() - started >= 30);
  const blocked = await merchant();
  const failure = await service(
    fake(blocked.name, async () => {
      throw new ProviderError('RATE_LIMIT', 'fixture', 3600);
    }),
  ).runSource(blocked.id, undefined, true);
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.errorCode, 'RETRY_AFTER_EXCEEDS_RUN');
  assert.equal(failure.requestCount, 1);
});
test('permanent access errors are not retried', async () => {
  const m = await merchant();
  let calls = 0;
  const result = await service(
    fake(m.name, async () => {
      calls++;
      throw new ProviderError('ACCESS_OR_QUOTA', 'fixture');
    }),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'FAILED');
  assert.equal(calls, 1);
});
test('failure on a later page is partial and preserves successful/existing products', async () => {
  const m = await merchant();
  await new OfferIngestionService(db, 'test').ingest(m.id, [
    { product: product(m, 'existing') },
  ]);
  const result = await service(
    fake(m.name, async (search) => {
      if (search?.page === 2) throw new ProviderError('UPSTREAM', 'fixture');
      return page([product(m, 'page-one')], 1, 2);
    }),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.processedCount, 1);
  assert.equal(await db.offer.count({ where: { merchantId: m.id } }), 2);
  const run = await db.syncRun.findFirstOrThrow({
    where: { merchantId: m.id, scope: 'SYNCHRONIZATION' },
  });
  assert.equal(run.status, 'PARTIAL');
  assert.equal(run.processedCount, 1);
});
test('invalid data rolls back only its page and never deletes prior pages', async () => {
  const m = await merchant();
  const result = await service(
    fake(m.name, async (search) =>
      search?.page === 1
        ? page([product(m, 'valid')], 1, 2)
        : page([product(m, 'invalid', { currentPrice: -1 })], 2, 2),
    ),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(await db.offer.count({ where: { merchantId: m.id } }), 1);
});
test('request/page/product budgets bound all retries and preserve offset page size', async () => {
  const m = await merchant();
  const exact = await service(new MockStoreProvider(m.name), {
    maxProducts: 5,
    pageSize: 2,
  }).runSource(m.id, undefined, true);
  assert.equal(exact.status, 'SUCCEEDED');
  assert.equal(exact.processedCount, 5);
  for (const limits of [
    { maxProducts: 3 },
    { maxPages: 1 },
    { maxRequests: 1 },
  ]) {
    const item = await merchant();
    const result = await service(
      new MockStoreProvider(item.name),
      limits,
    ).runSource(item.id, undefined, true);
    assert.equal(result.status, 'PARTIAL');
    assert.ok(result.processedCount <= (limits.maxProducts ?? 200));
    assert.ok(result.requestCount <= (limits.maxRequests ?? 20));
  }
});
test('an empty page is not a command to delete source data', async () => {
  const m = await merchant();
  await new OfferIngestionService(db, 'test').ingest(m.id, [
    { product: product(m) },
  ]);
  const result = await service(
    fake(m.name, async () => ({
      products: [],
      total: 0,
      totalPages: 0,
      skippedCount: 0,
    })),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(await db.offer.count({ where: { merchantId: m.id } }), 1);
});
test('separate database clients cannot synchronize the same source concurrently', async () => {
  const m = await merchant();
  const other = createDatabaseClient(process.env.DATABASE_URL!);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const provider = fake(m.name, async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return page([product(m)]);
  });
  const first = service(provider, { requestTimeoutMs: 1000 }).runSource(
    m.id,
    undefined,
    true,
  );
  await started;
  try {
    const second = await service(
      new MockStoreProvider(m.name),
      {},
      other,
    ).runSource(m.id, undefined, true);
    assert.equal(second.errorCode, 'SOURCE_BUSY');
  } finally {
    release();
    await first;
    await other.$disconnect();
  }
});
test('another process holding the source lock prevents Worker execution', async () => {
  const m = await merchant();
  const code = `import {createDatabaseClient} from './src/database/client.ts'; const db=createDatabaseClient(process.env.DATABASE_URL); await db.$transaction(async tx=>{await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtextextended(\${'worker-sync:'+process.env.TEST_MERCHANT_ID},0))\`;console.log('LOCKED');await new Promise(resolve=>process.stdin.once('data',resolve));},{timeout:10000});await db.$disconnect();`;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      env: { ...process.env, TEST_MERCHANT_ID: m.id },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 8000);
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      exited.then(() => {
        throw new Error('Lock holder exited');
      }),
    ]);
    const result = await service(new MockStoreProvider(m.name)).runSource(
      m.id,
      undefined,
      true,
    );
    assert.equal(result.errorCode, 'SOURCE_BUSY');
  } finally {
    child.stdin.end('release');
    await exited;
    clearTimeout(timer);
  }
});
test('shutdown cancels the active request and releases the source lock', async () => {
  const m = await merchant();
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const running = service(
    fake(
      m.name,
      async (_s, context) =>
        new Promise<ProductPage>((_resolve, reject) => {
          entered();
          context?.signal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          );
        }),
    ),
  ).runSource(m.id, controller.signal, true);
  await started;
  controller.abort();
  assert.equal((await running).status, 'CANCELLED');
  assert.equal(
    (
      await service(new MockStoreProvider(m.name)).runSource(
        m.id,
        undefined,
        true,
      )
    ).status,
    'SUCCEEDED',
  );
});
test('per-source due times are rechecked and earlier abandoned runs are finalized safely', async () => {
  const m = await merchant();
  const sync = service(new MockStoreProvider(m.name));
  await sync.runSource(m.id, undefined, true);
  assert.equal((await sync.runSource(m.id)).errorCode, 'NOT_DUE');
  await db.syncRun.create({
    data: {
      merchantId: m.id,
      sourceType: 'SYNTHETIC',
      scope: 'SYNCHRONIZATION',
    },
  });
  await sync.runSource(m.id, undefined, true);
  assert.equal(
    await db.syncRun.count({
      where: { merchantId: m.id, errorCode: 'WORKER_INTERRUPTED' },
    }),
    1,
  );
});
test('stale offers are marked in products and excluded from deal selections', async () => {
  const m = await merchant();
  await service(new MockStoreProvider(m.name)).runSource(m.id, undefined, true);
  const old = new Date(Date.now() - 10000);
  await db.offer.updateMany({
    where: { merchantId: m.id },
    data: { lastUpdatedAt: old, staleAt: new Date(Date.now() - 1000) },
  });
  const deals = (await (
    await fetch(`${root}/deals?merchantId=${m.id}`)
  ).json()) as any;
  assert.equal(deals.data.length, 0);
  const products = (await (
    await fetch(`${root}/products?merchantId=${m.id}`)
  ).json()) as any;
  assert.ok(products.data[0].offers[0].isStale);
});
test('score SQL equals the independent engine, and top/low-price selections remain distinct', async () => {
  const m = await merchant();
  const ingestion = new OfferIngestionService(db, 'test');
  await ingestion.ingest(m.id, [
    {
      product: product(m, 'trusted'),
      referencePriceTrusted: true,
      shippingCost: '0',
    },
    {
      product: product(m, 'untrusted', { currentPrice: 1 }),
      referencePriceTrusted: false,
    },
  ]);
  const now = new Date();
  const rows = await db.offer.findMany({
    where: { merchantId: m.id },
    include: { product: true },
  });
  const scores = await db.$queryRaw<{ id: string; score: Prisma.Decimal }[]>(
    Prisma.sql`SELECT o.id, (${dealScoreSql(now)}) AS score FROM offers o JOIN products p ON p.id=o.product_id WHERE o.merchant_id=${m.id}::uuid`,
  );
  for (const row of rows)
    assert.equal(
      scores.find((s) => s.id === row.id)?.score.toFixed(2),
      evaluateDeal(
        { ...row, imageUrl: row.product.imageUrl },
        now,
        defaultScoringRules,
      ).score,
    );
  const top = (await (
    await fetch(`${root}/deals?merchantId=${m.id}&view=top`)
  ).json()) as any;
  assert.equal(top.data.length, 1);
  assert.equal(top.data[0].externalProductId, 'trusted');
  const low = (await (
    await fetch(
      `${root}/deals?merchantId=${m.id}&view=low_price&currency=USD&maxPrice=2`,
    )
  ).json()) as any;
  assert.equal(low.data.length, 1);
  assert.equal(low.data[0].externalProductId, 'untrusted');
  assert.equal((await fetch(`${root}/deals?view=low_price`)).status, 400);
});
test('score sorting happens before pagination and all catalog filters remain active', async () => {
  const m = await merchant();
  await service(new MockStoreProvider(m.name)).runSource(m.id, undefined, true);
  for (const route of ['deals', 'products']) {
    const body = (await (
      await fetch(
        `${root}/${route}?merchantId=${m.id}&market=US&currency=USD&sort=score_desc&pageSize=1`,
      )
    ).json()) as any;
    assert.equal(body.data.length, 1);
    assert.ok(body.pagination.total > 1);
  }
});

test('cursor pagination follows tokens and repeated cursors stop without duplicate records', async () => {
  const m = await merchant();
  const result = await service(
    fake(m.name, async (search) =>
      search?.cursor
        ? {
            products: [product(m, 'cursor-2')],
            total: 2,
            totalPages: 2,
            skippedCount: 0,
          }
        : {
            products: [product(m, 'cursor-1')],
            total: 2,
            totalPages: 2,
            nextCursor: 'token-one',
            skippedCount: 0,
          },
    ),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.processedCount, 2);
  const repeated = await merchant();
  const stopped = await service(
    fake(repeated.name, async () => ({
      products: [product(repeated)],
      total: 100,
      totalPages: 100,
      nextCursor: 'same-token',
      skippedCount: 0,
    })),
  ).runSource(repeated.id, undefined, true);
  assert.equal(stopped.errorCode, 'REPEATED_CURSOR');
  assert.equal(await db.offer.count({ where: { merchantId: repeated.id } }), 1);
});
test('worker tick isolates source failures and runs retention cleanup without sweeping valid relationships', async () => {
  const bad = await merchant();
  const good = await merchant();
  const importer = new OfferIngestionService(db, 'test');
  await importer.ingest(bad.id, [
    { product: product(bad, 'preserved-on-failure') },
  ]);
  const expired = await importer.ingest(good.id, [
    { product: product(good, 'expired-cleanup') },
  ]);
  await db.offer.update({
    where: { id: expired.offerIds[0]! },
    data: {
      lastUpdatedAt: new Date(Date.now() - 10000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  // Limit the tick to these two sources while keeping other records untouched.
  await db.merchant.updateMany({
    where: {
      id: {
        in: merchants
          .map((m) => m.id)
          .filter((id) => id !== bad.id && id !== good.id),
      },
    },
    data: { syncEnabled: false },
  });
  const registry = new ProviderRegistry([
    {
      sourceType: 'SYNTHETIC',
      synthetic: true,
      create: (m) =>
        m.id === bad.id
          ? fake(m.name, async () => {
              throw new ProviderError('ACCESS_OR_QUOTA', 'fixture');
            })
          : new MockStoreProvider(m.name),
    },
  ]);
  const sync = new ProductSynchronizationService(db, registry, options, 'test');
  const worker = new BackgroundWorker(db, sync, options, 'test');
  const results = await worker.tick(new AbortController().signal, true);
  assert.equal(results.find((r) => r.merchantId === bad.id)?.status, 'FAILED');
  assert.equal(
    results.find((r) => r.merchantId === good.id)?.status,
    'SUCCEEDED',
  );
  assert.equal(await db.offer.count({ where: { merchantId: bad.id } }), 1);
  assert.equal(
    await db.offer.findUnique({ where: { id: expired.offerIds[0]! } }),
    null,
  );
  assert.equal(await db.offer.count({ where: { merchantId: good.id } }), 5);
});
test('production cannot invoke synthetic providers even with every opt-in flag set', async () => {
  const m = await merchant();
  let called = false;
  const result = await service(
    fake(m.name, async () => {
      called = true;
      return page([]);
    }),
    {},
    db,
    'production',
  ).runSource(m.id, undefined, true);
  assert.equal(result.errorCode, 'SOURCE_NOT_APPROVED');
  assert.equal(called, false);
  const body = await new CatalogService(db, false).deals({
    page: 1,
    pageSize: 20,
    sort: 'score_desc',
    merchantId: m.id,
  });
  assert.equal(body.data.length, 0);
});

test('a merchant relabeled during fetch cannot store mock data as commercial', async () => {
  const m = await merchant();
  const result = await service(
    fake(m.name, async () => {
      await db.merchant.update({
        where: { id: m.id },
        data: {
          sourceType: 'WOOCOMMERCE',
          isSynthetic: false,
          authorizationReference: 'TEST ONLY permission placeholder',
        },
      });
      return page([product(m)]);
    }),
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'FAILED');
  assert.equal(await db.offer.count({ where: { merchantId: m.id } }), 0);
});

test('whole-run deadline bounds an unresponsive provider and frees its source lock', async () => {
  const m = await merchant();
  const result = await service(
    fake(m.name, async () => new Promise<ProductPage>(() => {})),
    { maxRunMs: 100, requestTimeoutMs: 1000 },
  ).runSource(m.id, undefined, true);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'RUN_TIMEOUT');
  assert.equal(
    (
      await service(new MockStoreProvider(m.name)).runSource(
        m.id,
        undefined,
        true,
      )
    ).status,
    'SUCCEEDED',
  );
});

test('scheduled Worker executes due sources again and stops cleanly when aborted', async () => {
  const m = await merchant();
  await db.merchant.updateMany({
    where: {
      id: { in: merchants.map((row) => row.id).filter((id) => id !== m.id) },
    },
    data: { syncEnabled: false },
  });
  await db.merchant.update({
    where: { id: m.id },
    data: { syncIntervalSeconds: 1 },
  });
  let calls = 0;
  const registry = new ProviderRegistry([
    {
      sourceType: 'SYNTHETIC',
      synthetic: true,
      create: (entry) =>
        fake(entry.name, async () => {
          calls++;
          return page([product(entry)]);
        }),
    },
  ]);
  const sync = new ProductSynchronizationService(db, registry, options, 'test');
  const worker = new BackgroundWorker(
    db,
    sync,
    { ...options, pollMs: 100 },
    'test',
  );
  const controller = new AbortController();
  const running = worker.start(controller.signal);
  const deadline = Date.now() + 4000;
  try {
    while (
      Date.now() < deadline &&
      (await db.syncRun.count({
        where: {
          merchantId: m.id,
          status: 'SUCCEEDED',
          scope: 'SYNCHRONIZATION',
        },
      })) < 2
    )
      await sleep(50);
    assert.ok(calls >= 2);
    assert.ok(
      (await db.syncRun.count({
        where: {
          merchantId: m.id,
          status: 'SUCCEEDED',
          scope: 'SYNCHRONIZATION',
        },
      })) >= 2,
    );
  } finally {
    controller.abort();
    await running;
  }
});

test('periodic cleanup continues while a provider request is still waiting', async () => {
  const expiredSource = await merchant();
  const slow = await merchant();
  const entry = await new OfferIngestionService(db, 'test').ingest(
    expiredSource.id,
    [{ product: product(expiredSource, 'cleanup-during-fetch') }],
  );
  await db.merchant.updateMany({
    where: {
      id: { in: merchants.map((row) => row.id).filter((id) => id !== slow.id) },
    },
    data: { syncEnabled: false },
  });
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const registry = new ProviderRegistry([
    {
      sourceType: 'SYNTHETIC',
      synthetic: true,
      create: (m) =>
        fake(m.name, async () => {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return page([product(m)]);
        }),
    },
  ]);
  const settings = { ...options, requestTimeoutMs: 2000, cleanupMs: 50 };
  const worker = new BackgroundWorker(
    db,
    new ProductSynchronizationService(db, registry, settings, 'test'),
    settings,
    'test',
  );
  const controller = new AbortController();
  const running = worker.start(controller.signal);
  try {
    await started;
    await db.offer.update({
      where: { id: entry.offerIds[0]! },
      data: {
        lastUpdatedAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const deadline = Date.now() + 1000;
    while (
      Date.now() < deadline &&
      (await db.offer.findUnique({ where: { id: entry.offerIds[0]! } }))
    )
      await sleep(20);
    assert.equal(
      await db.offer.findUnique({ where: { id: entry.offerIds[0]! } }),
      null,
    );
    assert.equal(
      await db.syncRun.count({
        where: { merchantId: slow.id, status: 'RUNNING' },
      }),
      1,
    );
  } finally {
    controller.abort();
    release();
    await running;
  }
});
