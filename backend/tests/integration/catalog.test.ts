import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { before, after, test } from 'node:test';
import { createDatabaseClient } from '../../src/database/client.js';
import { assertTestDatabase } from '../../src/database/development-guard.js';
import { CatalogService } from '../../src/services/catalog.js';
import { parseCatalogQuery } from '../../src/services/catalog-query.js';
import { OfferIngestionService } from '../../src/services/offer-ingestion.js';
import { seedDevelopment } from '../../src/database/seed.js';
import { createApp } from '../../src/app.js';
import type { StoreProduct } from '../../src/providers/store-provider.js';

if (process.env.CATALOG_INTEGRATION !== '1')
  throw new Error(
    'Run npm run test:integration against the guarded test database.',
  );
// The runner has already checked the development URL and switched DATABASE_URL.
assertTestDatabase(
  process.env.DATABASE_URL,
  'postgresql://localhost/dealfinder',
);
const db = createDatabaseClient(process.env.DATABASE_URL!);
const ingest = new OfferIngestionService(db, 'test');
const catalog = new CatalogService(db, true);
const prefix = `INTEGRATION ${randomUUID()}`;
const merchantIds: string[] = [];
let merchantA: { id: string; name: string };
let merchantB: { id: string; name: string };
let categoryId: string;
let parentId: string;
let alphaId: string;
let alphaProductId: string;
let expiredId: string;
let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
function normalized(
  merchant: { name: string },
  externalId: string,
  change: Partial<StoreProduct> = {},
): StoreProduct {
  return {
    externalId,
    store: merchant.name,
    name: `${prefix} ${externalId}`,
    currentPrice: 10.123456,
    originalPrice: 20.246912,
    currency: 'USD',
    market: 'US',
    availability: 'available',
    fetchedAt: new Date().toISOString(),
    ...change,
  };
}
async function merchant(label: string) {
  const row = await db.merchant.create({
    data: {
      name: `${prefix} ${label}`,
      sourceType: 'SYNTHETIC',
      websiteUrl: `https://${randomUUID()}.example.invalid`,
      enabled: true,
      storageAuthorized: true,
      retentionSeconds: 86400,
      isSynthetic: true,
    },
  });
  merchantIds.push(row.id);
  return row;
}
async function get(path: string) {
  const response = await fetch(base + path);
  return { status: response.status, body: (await response.json()) as any };
}

before(async () => {
  merchantA = await merchant('A');
  merchantB = await merchant('B');
  const parent = await db.category.create({
    data: { name: 'TEST Parent', slug: randomUUID(), isSynthetic: true },
  });
  parentId = parent.id;
  categoryId = (
    await db.category.create({
      data: {
        name: 'TEST Child',
        slug: randomUUID(),
        parentId,
        isSynthetic: true,
      },
    })
  ).id;
  const result = await ingest.ingest(merchantA.id, [
    { categoryId, product: normalized(merchantA, 'alpha') },
    {
      product: normalized(merchantA, 'beta', {
        currentPrice: 5,
        originalPrice: 5,
      }),
    },
    {
      categoryId,
      product: normalized(merchantA, 'euro', {
        currentPrice: 8,
        originalPrice: 10,
        currency: 'EUR',
        market: 'DE',
      }),
    },
    {
      product: normalized(merchantA, 'missing', {
        currentPrice: undefined,
        originalPrice: undefined,
        currency: undefined,
        market: undefined,
        availability: undefined,
      } as unknown as Partial<StoreProduct>),
    },
    { product: normalized(merchantA, 'expired') },
  ]);
  assert.equal(result.offerIds.length, 5);
  const alpha = await db.offer.findFirstOrThrow({
    where: { merchantId: merchantA.id, externalProductId: 'alpha' },
  });
  alphaId = alpha.id;
  alphaProductId = alpha.productId;
  const expired = await db.offer.findFirstOrThrow({
    where: { merchantId: merchantA.id, externalProductId: 'expired' },
  });
  expiredId = expired.id;
  await db.offer.update({
    where: { id: expiredId },
    data: {
      expiresAt: new Date(Date.now() - 1000),
      lastUpdatedAt: new Date(Date.now() - 10000),
    },
  });
  await ingest.ingest(merchantB.id, [
    {
      product: normalized(merchantB, 'same-name', {
        name: `${prefix} alpha`,
        currentPrice: 9,
        originalPrice: 12,
      }),
    },
  ]);
  server = createApp({ CORS_ORIGINS: [] }, catalog).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  // Only rows owned by this test run, never a database-wide reset/truncate.
  await db.offer.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await db.product.deleteMany({
    where: { contentMerchantId: { in: merchantIds } },
  });
  await db.syncRun.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await db.merchant.deleteMany({ where: { id: { in: merchantIds } } });
  if (categoryId) await db.category.delete({ where: { id: categoryId } });
  if (parentId) await db.category.delete({ where: { id: parentId } });
  await db.$disconnect();
});

test('database relations enforce merchants, product categories and hierarchy', async () => {
  const product = await db.product.findUniqueOrThrow({
    where: { id: alphaProductId },
    include: { category: { include: { parent: true } }, offers: true },
  });
  assert.equal(product.category?.parent?.id, parentId);
  assert.ok(product.offers.length > 0);
  await assert.rejects(db.category.delete({ where: { id: parentId } }));
  await assert.rejects(
    db.offer.update({
      where: { id: alphaId },
      data: { merchantId: randomUUID() },
    }),
  );
});

test('Decimal amounts survive storage and JSON without float arithmetic', async () => {
  const offer = await db.offer.findUniqueOrThrow({ where: { id: alphaId } });
  assert.equal(offer.currentPrice?.toFixed(), '10.123456');
  assert.equal(offer.discountPercentage?.toFixed(), '50');
  const response = await get(`/deals/${alphaId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.currentPrice, '10.123456');
  assert.equal(response.body.data.isSynthetic, true);
});

test('duplicate source records are upserted under concurrency without orphan products', async () => {
  const record = normalized(merchantA, 'concurrent');
  const [a, b] = await Promise.all([
    ingest.ingest(merchantA.id, [{ product: record }]),
    ingest.ingest(merchantA.id, [{ product: record }]),
  ]);
  assert.equal(a.offerIds[0], b.offerIds[0]);
  assert.equal(
    await db.offer.count({
      where: { merchantId: merchantA.id, externalProductId: 'concurrent' },
    }),
    1,
  );
  assert.equal(
    await db.product.count({
      where: {
        contentMerchantId: merchantA.id,
        contentExternalId: 'concurrent',
      },
    }),
    1,
  );
  const row = await db.offer.findUniqueOrThrow({
    where: { id: a.offerIds[0]! },
  });
  await assert.rejects(db.offer.create({ data: { ...row, id: randomUUID() } }));
});

test('market, currency and variant form independent source identities', async () => {
  const result = await ingest.ingest(merchantA.id, [
    { variantKey: 'blue', product: normalized(merchantA, 'variants') },
    { variantKey: 'red', product: normalized(merchantA, 'variants') },
    {
      variantKey: 'blue',
      product: normalized(merchantA, 'variants', { market: 'CA' }),
    },
    {
      variantKey: 'blue',
      product: normalized(merchantA, 'variants', { currency: 'CAD' }),
    },
  ]);
  assert.equal(new Set(result.offerIds).size, 4);
});

test('equal names from different merchants never merge; explicit association supports multiple offers', async () => {
  const separate = await db.offer.findFirstOrThrow({
    where: { merchantId: merchantB.id, externalProductId: 'same-name' },
  });
  assert.notEqual(separate.productId, alphaProductId);
  await ingest.ingest(merchantB.id, [
    {
      productId: alphaProductId,
      product: normalized(merchantB, 'verified-link'),
    },
  ]);
  const result = await get(`/products/${alphaProductId}`);
  assert.equal(result.body.data.offers.length, 2);
});

test('batch failures roll back products/offers and record safe failed sync status', async () => {
  const count = await db.product.count({
    where: { contentMerchantId: merchantA.id },
  });
  await assert.rejects(
    ingest.ingest(merchantA.id, [
      { product: normalized(merchantA, 'aa-before-failure') },
      {
        categoryId: randomUUID(),
        product: normalized(merchantA, 'zz-failure'),
      },
    ]),
  );
  assert.equal(
    await db.product.count({ where: { contentMerchantId: merchantA.id } }),
    count,
  );
  const run = await db.syncRun.findFirstOrThrow({
    where: { merchantId: merchantA.id, status: 'FAILED' },
    orderBy: { startedAt: 'desc' },
  });
  assert.equal(run.processedCount, 0);
  assert.equal(run.errorCode, 'INGESTION_FAILED');
  assert.ok(!run.errorDetails?.includes('postgresql://'));
});

test('storage authorization, production synthetic ban and expired input are enforced', async () => {
  const denied = await db.merchant.create({
    data: {
      name: 'Denied',
      sourceType: 'WOOCOMMERCE',
      websiteUrl: `https://${randomUUID()}.example.invalid`,
      enabled: true,
    },
  });
  merchantIds.push(denied.id);
  await assert.rejects(
    ingest.ingest(denied.id, [{ product: normalized(denied, 'denied') }]),
  );
  await assert.rejects(
    new OfferIngestionService(db, 'production').ingest(merchantA.id, [
      { product: normalized(merchantA, 'demo') },
    ]),
  );
  await assert.rejects(
    ingest.ingest(merchantA.id, [
      {
        product: normalized(merchantA, 'too-old', {
          fetchedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        }),
      },
    ]),
  );
});

test('older snapshots do not overwrite a newer stored price', async () => {
  const before = await db.offer.findUniqueOrThrow({ where: { id: alphaId } });
  await ingest.ingest(merchantA.id, [
    {
      product: normalized(merchantA, 'alpha', {
        currentPrice: 1,
        fetchedAt: new Date(
          before.lastUpdatedAt.getTime() - 1000,
        ).toISOString(),
      }),
    },
  ]);
  assert.equal(
    (
      await db.offer.findUniqueOrThrow({ where: { id: alphaId } })
    ).currentPrice?.toFixed(),
    '10.123456',
  );
});

test('missing prices, images, market and availability stay unknown; incomplete products are not deals', async () => {
  const row = await db.offer.findFirstOrThrow({
    where: { merchantId: merchantA.id, externalProductId: 'missing' },
  });
  const response = await get(`/products/${row.productId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.imageUrl, null);
  assert.equal(response.body.data.offers[0].currentPrice, null);
  assert.equal(response.body.data.offers[0].currency, null);
  assert.equal(response.body.data.offers[0].availability, 'UNKNOWN');
  assert.equal((await get(`/deals/${row.id}`)).status, 404);
});

test('expired offers are excluded from list/detail, including nested product offers', async () => {
  assert.equal((await get(`/deals/${expiredId}`)).status, 404);
  const result = await get(`/deals?q=${encodeURIComponent(prefix)}`);
  assert.ok(!result.body.data.some((row: any) => row.id === expiredId));
  const expired = await db.offer.findUniqueOrThrow({
    where: { id: expiredId },
  });
  assert.equal((await get(`/products/${expired.productId}`)).status, 404);
});

test('combined filters target the same offer and compare prices in one currency', async () => {
  const path = `/deals?q=${encodeURIComponent(prefix + ' alpha')}&merchantId=${merchantA.id}&categoryId=${categoryId}&market=US&currency=USD&minPrice=10&maxPrice=11&sort=price_asc`;
  const result = await get(path);
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.data.map((row: any) => row.id),
    [alphaId],
  );
  assert.equal((await get('/deals?sort=price_asc')).status, 400);
  assert.equal((await get('/products?minPrice=1')).status, 400);
  assert.equal(
    (await get('/deals?currency=USD&minPrice=20&maxPrice=10')).status,
    400,
  );
});

test('pagination totals count products before pagination and all four sorting options work', async () => {
  for (const route of ['products', 'deals']) {
    const path = `/${route}?q=${encodeURIComponent(prefix)}&currency=USD&pageSize=2&sort=price_asc`;
    const first = (await get(path)).body;
    const second = (await get(path + '&page=2')).body;
    assert.equal(first.data.length, 2);
    assert.equal(first.pagination.total, second.pagination.total);
    assert.ok(first.pagination.total > 2);
    assert.ok(
      !first.data.some((a: any) => second.data.some((b: any) => a.id === b.id)),
    );
    for (const sort of ['price_desc', 'discount_desc', 'newest'])
      assert.equal(
        (await get(`/${route}?currency=USD&sort=${sort}&pageSize=1`)).status,
        200,
      );
  }
});

test('categories and merchants provide paginated safe responses, with 400/404 errors', async () => {
  assert.equal((await get('/categories?pageSize=1')).body.data.length, 1);
  const merchants = (await get('/merchants?pageSize=100')).body.data;
  assert.ok(merchants.some((row: any) => row.id === merchantA.id));
  assert.ok(merchants.every((row: any) => !('authorizationReference' in row)));
  assert.equal((await get('/products/not-a-uuid')).status, 400);
  assert.equal((await get(`/products/${randomUUID()}`)).status, 404);
  assert.equal((await get('/deals?pageSize=101')).status, 400);
  assert.equal((await get('/deals?unsupported=1')).status, 400);
});

test('search treats percent/underscore literally and product totals agree with returned rows', async () => {
  for (const query of ['%', '_']) {
    for (const route of ['products', 'deals']) {
      const result = await get(`/${route}?q=${encodeURIComponent(query)}`);
      assert.equal(result.body.pagination.total, 0);
      assert.equal(result.body.data.length, 0);
    }
  }
});

test('central errors return a safe 500 for database/service failures', async () => {
  const failing = createApp({ CORS_ORIGINS: [] }, {
    deals: async () => {
      throw new Error('sensitive-private-error');
    },
  } as unknown as CatalogService).listen(0, '127.0.0.1');
  await once(failing, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${(failing.address() as AddressInfo).port}/api/v1/deals`,
    );
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.ok(!body.includes('sensitive-private-error'));
    assert.match(body, /INTERNAL_ERROR/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      failing.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('production catalog excludes all synthetic rows', async () => {
  const production = new CatalogService(db, false);
  const query = parseCatalogQuery({ q: prefix });
  assert.equal((await production.deals(query)).data.length, 0);
  assert.equal((await production.products(query)).data.length, 0);
});

test('revoking merchant visibility hides its product content even through another merchant offer', async () => {
  await db.merchant.update({
    where: { id: merchantA.id },
    data: { storageAuthorized: false },
  });
  assert.equal((await get(`/products/${alphaProductId}`)).status, 404);
  await db.merchant.update({
    where: { id: merchantA.id },
    data: { storageAuthorized: true },
  });
});

test('manual purge erases expired source metadata without deleting another merchant valid offer', async () => {
  const row = await ingest.ingest(merchantA.id, [
    {
      product: normalized(merchantA, 'purge', {
        imageUrl: 'https://example.invalid/expired.png',
      }),
    },
  ]);
  const offer = await db.offer.findUniqueOrThrow({
    where: { id: row.offerIds[0]! },
  });
  await ingest.ingest(merchantB.id, [
    {
      productId: offer.productId,
      product: normalized(merchantB, 'valid-after-purge'),
    },
  ]);
  await db.product.update({
    where: { id: offer.productId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await ingest.purgeExpired();
  const product = await db.product.findUniqueOrThrow({
    where: { id: offer.productId },
  });
  assert.equal(product.name, '[Expired source content]');
  assert.equal(product.imageUrl, null);
  assert.equal(
    await db.offer.count({
      where: { productId: offer.productId, merchantId: merchantB.id },
    }),
    1,
  );
});

test('QA: nested offer fanout is bounded while saved offers remain resolvable', async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({
    productId: alphaProductId,
    product: normalized(merchantA, 'qa-fanout-' + i),
  }));
  const saved = await ingest.ingest(merchantA.id, items);
  const result = await catalog.product(alphaProductId);
  assert.equal(result.data.offers.length, 20);
  assert.equal(result.data.offersTruncated, true);
  const exact = await get(
    '/products/' + alphaProductId + '?offerId=' + saved.offerIds[24],
  );
  assert.equal(exact.status, 200);
  assert.equal(exact.body.data.offers.length, 1);
  assert.equal(exact.body.data.offers[0].id, saved.offerIds[24]);
});

test('development seed is idempotent without deleting existing rows', async () => {
  await seedDevelopment(db);
  const products = await db.product.count({
    where: { contentMerchant: { websiteUrl: 'https://alpha.example.invalid' } },
  });
  await seedDevelopment(db);
  assert.equal(
    await db.product.count({
      where: {
        contentMerchant: { websiteUrl: 'https://alpha.example.invalid' },
      },
    }),
    products,
  );
  assert.ok(await db.offer.findUnique({ where: { id: alphaId } }));
});

test('QA: SQL/XSS payloads remain literal data, and wildcard searches are escaped', async () => {
  const beforeCount = await db.offer.count();
  for (const q of ["' OR 1=1 --", '%_\\', "<script>alert('x')</script>"]) {
    const response = await fetch(base + '/deals?q=' + encodeURIComponent(q));
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/json/,
    );
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const body = (await response.json()) as { data: unknown[] };
    assert.equal(body.data.length, 0);
  }
  assert.equal(await db.offer.count(), beforeCount);
});
