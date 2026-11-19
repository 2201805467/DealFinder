import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createDatabaseClient } from '../../src/database/client.js';
import { assertTestDatabase } from '../../src/database/development-guard.js';
import { parseWorkerEnvironment } from '../../src/config/worker.js';
import { ProductSynchronizationService } from '../../src/services/product-synchronization.js';
import { ProviderRegistry } from '../../src/services/provider-registry.js';
import { SourceHttpClient } from '../../src/providers/source-http.js';
import { CheapSharkProvider } from '../../src/providers/cheapshark/cheapshark-provider.js';
import { GamerPowerProvider } from '../../src/providers/gamerpower/gamerpower-provider.js';
import { CatalogService } from '../../src/services/catalog.js';
import { OfferIngestionService } from '../../src/services/offer-ingestion.js';
import { parseCatalogQuery } from '../../src/services/catalog-query.js';
import { createApp } from '../../src/app.js';
import { BackgroundWorker } from '../../src/jobs/background-worker.js';
import { normalizeCheapShark } from '../../src/providers/cheapshark/cheapshark-provider.js';

if (process.env.CATALOG_INTEGRATION !== '1')
  throw new Error('Use guarded test:integration.');
assertTestDatabase(
  process.env.DATABASE_URL,
  'postgresql://localhost/dealfinder',
);
const db = createDatabaseClient(process.env.DATABASE_URL!);
const prefix = 'TEST ONLY source integration ' + randomUUID();
const roots: string[] = [];
let cheapId: string, gamerId: string;
let price = '9.99',
  dealId = 'test%2Fone%3D',
  failures = 0,
  requests = 0;
const json = (v: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { headers });
const registry = new ProviderRegistry([
  {
    sourceType: 'CHEAPSHARK',
    synthetic: false,
    create: () =>
      new CheapSharkProvider(
        new SourceHttpClient(async (input) => {
          requests++;
          if (failures-- > 0)
            return new Response('private upstream details', { status: 503 });
          const url = new URL(String(input));
          return url.pathname.endsWith('/stores')
            ? json([
                { storeID: '1', storeName: prefix + ' retailer', isActive: 1 },
              ])
            : json(
                [
                  {
                    gameID: '456',
                    dealID: dealId,
                    storeID: '1',
                    title: prefix + ' game',
                    salePrice: price,
                    normalPrice: '20.00',
                    isOnSale: '1',
                  },
                ],
                { 'x-total-page-count': '1' },
              );
        }, 0),
      ),
  },
  {
    sourceType: 'GAMERPOWER',
    synthetic: false,
    create: () =>
      new GamerPowerProvider(
        new SourceHttpClient(
          async () =>
            json([
              {
                id: 99,
                title: prefix + ' giveaway',
                platforms: 'PC, Steam',
                type: 'Loot',
                status: 'Active',
                end_date: 'N/A',
                open_giveaway_url: 'https://www.gamerpower.com/open/test-only',
              },
            ]),
          0,
        ),
      ),
  },
]);
const options = parseWorkerEnvironment({
  WORKER_ENABLED: 'true',
  CHEAPSHARK_ENABLED: 'true',
  GAMERPOWER_ENABLED: 'true',
  WORKER_BACKOFF_MS: '1',
  WORKER_MAX_BACKOFF_MS: '2',
});
const sync = new ProductSynchronizationService(db, registry, options, 'test');
const catalog = new CatalogService(db, false);
let server: ReturnType<ReturnType<typeof createApp>['listen']>, base: string;
before(async () => {
  for (const sourceType of ['CHEAPSHARK', 'GAMERPOWER'] as const) {
    const root = await db.merchant.create({
      data: {
        name: prefix + sourceType,
        sourceType,
        websiteUrl: `https://${randomUUID()}.example.invalid`,
        isDataSource: true,
        enabled: true,
        storageAuthorized: true,
        authorizationReference: 'TEST ONLY official-policy fixture',
        retentionSeconds: 600,
        staleAfterSeconds: 600,
        syncEnabled: true,
      },
    });
    roots.push(root.id);
  }
  [cheapId, gamerId] = roots as [string, string];
  server = createApp(
    { CORS_ORIGINS: [], NODE_ENV: 'production' },
    catalog,
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.offer.deleteMany({
    where: { product: { contentMerchantId: { in: roots } } },
  });
  await db.product.deleteMany({ where: { contentMerchantId: { in: roots } } });
  await db.syncRun.deleteMany({ where: { merchantId: { in: roots } } });
  await db.merchant.deleteMany({ where: { dataSourceId: { in: roots } } });
  await db.merchant.deleteMany({ where: { id: { in: roots } } });
  await db.$disconnect();
});
test('reviewed sources remain disabled without opt-in; CheapShark cannot crawl on a schedule', async () => {
  const disabled = new ProductSynchronizationService(
    db,
    registry,
    parseWorkerEnvironment({ WORKER_ENABLED: 'true' }),
    'production',
  );
  assert.equal(
    (await disabled.runSource(cheapId, undefined, true)).errorCode,
    'SOURCE_NOT_APPROVED',
  );
  assert.equal(
    (await sync.runSource(cheapId)).errorCode,
    'SOURCE_NOT_APPROVED',
  );
  assert.equal(requests, 0);
});
test('mock API → shared synchronization → PostgreSQL → production REST separates source/retailer', async () => {
  const result = await sync.runSource(cheapId, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.processedCount, 1);
  assert.equal(result.requestCount, 2);
  const response = await fetch(
    base + '/deals?view=all&q=' + encodeURIComponent(prefix),
  );
  assert.equal(response.status, 200);
  const data = ((await response.json()) as any).data;
  assert.equal(data.length, 1);
  assert.equal(data[0].merchant.name, prefix + ' retailer');
  assert.equal(data[0].merchant.websiteUrl, null);
  assert.equal(data[0].source.key, 'CHEAPSHARK');
  assert.equal(data[0].source.attributionUrl, 'https://www.cheapshark.com/');
  assert.equal(data[0].currentPrice, '9.99');
  assert.equal(data[0].discountPercentage, '50.05');
  assert.equal(data[0].isSynthetic, false);
});
test('changing deal ID/price keeps stable retailer+game identity and updates generated score factors', async () => {
  const before = await db.offer.findFirstOrThrow({
    where: { merchant: { dataSourceId: cheapId } },
  });
  price = '4.99';
  dealId = 'test%2Fchanged%3D';
  assert.equal(
    (await sync.runSource(cheapId, undefined, true)).status,
    'SUCCEEDED',
  );
  const offers = await db.offer.findMany({
    where: { merchant: { dataSourceId: cheapId } },
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0]!.id, before.id);
  assert.equal(offers[0]!.productId, before.productId);
  assert.equal(offers[0]!.currentPrice?.toFixed(), '4.99');
  assert.equal(
    await db.product.count({ where: { contentMerchantId: cheapId } }),
    1,
  );
  assert.equal(
    new URL(offers[0]!.productUrl!).searchParams.get('dealID'),
    'test/changed=',
  );
  const score = await catalog.deal(before.id);
  assert.equal(score.data.scoreComponents.discount, '35');
});
test('temporary upstream retry counts real HTTP attempts without duplicates or deletion', async () => {
  failures = 1;
  const result = await sync.runSource(cheapId, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.requestCount, 2);
  assert.equal(
    await db.offer.count({ where: { merchant: { dataSourceId: cheapId } } }),
    1,
  );
});
test('giveaways appear in all/newest and detail, never fabricate discounts or top deals', async () => {
  const result = await sync.runSource(gamerId, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  const all = await catalog.deals(
    parseCatalogQuery({ q: prefix, view: 'all', sort: 'newest' }),
  );
  const free = all.data.find((o) => o.source?.key === 'GAMERPOWER')!;
  assert.ok(free);
  assert.equal(free.currentPrice, '0');
  assert.equal(free.referencePrice, null);
  assert.equal(free.discountPercentage, null);
  assert.equal(free.referencePriceTrusted, false);
  assert.notEqual(free.scoreClassification, 'TOP_DEAL');
  assert.equal(free.market, null);
  assert.equal((await catalog.deal(free.id)).data.id, free.id);
  assert.ok(
    !(
      await catalog.deals(parseCatalogQuery({ q: prefix, view: 'top' }))
    ).data.some((o) => o.id === free.id),
  );
  const oldId = free.id;
  await sync.runSource(gamerId, undefined, true);
  assert.equal((await catalog.deal(oldId)).data.id, oldId);
});
test('revoking source permission hides downstream retailers through raw SQL and ORM API paths', async () => {
  await db.merchant.update({
    where: { id: cheapId },
    data: { storageAuthorized: false },
  });
  const query = parseCatalogQuery({ q: prefix + ' game', view: 'all' });
  assert.equal((await catalog.deals(query)).data.length, 0);
  assert.equal((await catalog.products(query)).data.length, 0);
  await db.merchant.update({
    where: { id: cheapId },
    data: { storageAuthorized: true },
  });
});
test('expired real-source content excluded then purged without unrelated-data deletion', async () => {
  const offer = await db.offer.findFirstOrThrow({
    where: { merchant: { dataSourceId: gamerId } },
  });
  await db.offer.update({
    where: { id: offer.id },
    data: {
      lastUpdatedAt: new Date(Date.now() - 20000),
      expiresAt: new Date(Date.now() - 10000),
    },
  });
  await assert.rejects(catalog.deal(offer.id), { code: 'NOT_FOUND' });
  await new OfferIngestionService(db, 'test').purgeExpired();
  assert.equal(await db.offer.findUnique({ where: { id: offer.id } }), null);
  assert.equal(
    await db.offer.count({ where: { merchant: { dataSourceId: cheapId } } }),
    1,
  );
});

test('official CheapShark game ID groups multiple retailer offers without name-based merging', async () => {
  const product = normalizeCheapShark(
    {
      gameID: '456',
      dealID: 'test%2Fretailer-two%3D',
      storeID: '2',
      title: prefix + ' game',
      salePrice: '6.00',
      normalPrice: '20.00',
      isOnSale: '1',
    },
    new Map([['2', prefix + ' second retailer']]),
    new Date().toISOString(),
  )!;
  await new OfferIngestionService(db, 'test').ingest(cheapId, [{ product }]);
  const rows = await db.offer.findMany({
    where: { merchant: { dataSourceId: cheapId } },
  });
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((o) => o.productId)).size, 1);
  assert.equal(
    await db.product.count({ where: { contentMerchantId: cheapId } }),
    1,
  );
});

test('one GamerPower HTTP request can serve multiple local pages within a one-request budget', async () => {
  const isolated = await db.merchant.create({
    data: {
      name: prefix + ' paging',
      sourceType: 'GAMERPOWER',
      websiteUrl: `https://${randomUUID()}.example.invalid`,
      isDataSource: true,
      enabled: true,
      storageAuthorized: true,
      authorizationReference: 'TEST ONLY policy',
      retentionSeconds: 600,
      staleAfterSeconds: 600,
      syncEnabled: true,
    },
  });
  roots.push(isolated.id);
  let calls = 0;
  const pages = new ProviderRegistry([
    {
      sourceType: 'GAMERPOWER',
      synthetic: false,
      create: () =>
        new GamerPowerProvider(
          new SourceHttpClient(async () => {
            calls++;
            return json(
              [101, 102].map((id) => ({
                id,
                title: prefix + id,
                platforms: 'PC',
                type: 'DLC',
                status: 'Active',
                end_date: 'N/A',
                open_giveaway_url: 'https://www.gamerpower.com/open/test-' + id,
              })),
            );
          }, 0),
        ),
    },
  ]);
  const service = new ProductSynchronizationService(
    db,
    pages,
    { ...options, maxRequests: 1, pageSize: 1 },
    'test',
  );
  const result = await service.runSource(isolated.id, undefined, true);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.pageCount, 2);
  assert.equal(result.processedCount, 2);
  assert.equal(result.requestCount, 1);
  assert.equal(calls, 1);
  const next = await db.merchant.findUniqueOrThrow({
    where: { id: isolated.id },
  });
  assert.equal(next.syncCheckpoint, null);
});

test('real BackgroundWorker selects the approved source in production mode and never synchronizes synthetic rows', async () => {
  // Only this file's fixtures are changed, in the independently guarded _test database.
  await db.merchant.updateMany({
    where: { id: { in: roots } },
    data: { syncEnabled: false },
  });
  const target = await db.merchant.create({
    data: {
      name: prefix + ' worker',
      sourceType: 'GAMERPOWER',
      websiteUrl: `https://${randomUUID()}.example.invalid`,
      isDataSource: true,
      enabled: true,
      storageAuthorized: true,
      authorizationReference: 'TEST ONLY policy fixture',
      retentionSeconds: 600,
      staleAfterSeconds: 600,
      syncEnabled: true,
    },
  });
  const synthetic = await db.merchant.create({
    data: {
      name: prefix + ' synthetic excluded',
      sourceType: 'SYNTHETIC',
      websiteUrl: `https://${randomUUID()}.example.invalid`,
      isDataSource: true,
      isSynthetic: true,
      enabled: true,
      storageAuthorized: true,
      retentionSeconds: 600,
      syncEnabled: true,
    },
  });
  roots.push(target.id, synthetic.id);
  let calls = 0;
  const providers = new ProviderRegistry([
    {
      sourceType: 'GAMERPOWER',
      synthetic: false,
      create: () =>
        new GamerPowerProvider(
          new SourceHttpClient(async () => {
            calls++;
            return json([
              {
                id: 9876,
                title: prefix + ' worker product',
                platforms: 'PC',
                type: 'DLC',
                status: 'Active',
                end_date: 'N/A',
                open_giveaway_url:
                  'https://www.gamerpower.com/open/test-worker-only',
              },
            ]);
          }, 0),
        ),
    },
  ]);
  const approved = { ...options, cheapSharkEnabled: false };
  const service = new ProductSynchronizationService(
    db,
    providers,
    approved,
    'production',
  );
  const worker = new BackgroundWorker(
    db,
    service,
    approved,
    'production',
    'real',
  );
  const result = await worker.tick(new AbortController().signal, true, false);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.merchantId, target.id);
  assert.equal(result[0]!.status, 'SUCCEEDED');
  assert.equal(calls, 1);
  assert.equal(
    await db.syncRun.count({ where: { merchantId: synthetic.id } }),
    0,
  );
  const response = await catalog.deals(
    parseCatalogQuery({ q: prefix + ' worker product', view: 'all' }),
  );
  assert.equal(response.data.length, 1);
  assert.equal(response.data[0]!.source?.key, 'GAMERPOWER');
  assert.equal(response.data[0]!.currentPrice, '0');
});
