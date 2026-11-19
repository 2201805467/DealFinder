import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createDatabaseClient } from '../../src/database/client.js';
import { assertTestDatabase } from '../../src/database/development-guard.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
  dealScoreSql,
  legacyDealScoreSql,
  defaultScoringRules,
  evaluateDeal,
} from '../../src/scoring/deal-scoring.js';
import { CatalogService } from '../../src/services/catalog.js';
import { parseCatalogQuery } from '../../src/services/catalog-query.js';
if (process.env.CATALOG_INTEGRATION !== '1')
  throw Error('Use the guarded integration runner');
assertTestDatabase(
  process.env.DATABASE_URL,
  'postgresql://localhost/dealfinder',
);
const db = createDatabaseClient(process.env.DATABASE_URL!),
  anchor = new Date('2026-11-19T09:00:00.000Z');
let merchantId: string;
const ids: string[] = [];
before(async () => {
  const m = await db.merchant.create({
    data: {
      name: 'SYNTHETIC scoring optimization ' + randomUUID(),
      sourceType: 'SYNTHETIC',
      websiteUrl: 'https://' + randomUUID() + '.example.invalid',
      enabled: true,
      storageAuthorized: true,
      isSynthetic: true,
      retentionSeconds: 86400,
    },
  });
  merchantId = m.id;
  const prices = [
    '0',
    '0.000001',
    '19.999999',
    '100',
    '999999999999999999.999998',
  ];
  for (let i = 0; i < 120; i++) {
    const p = await db.product.create({
      data: {
        name: 'SYNTHETIC optimization ' + i,
        contentMerchantId: m.id,
        contentExternalId: String(i),
        isSynthetic: true,
        imageUrl: i % 3 ? 'https://image.example.invalid/x.png' : null,
      },
    });
    const price = new Prisma.Decimal(prices[i % prices.length]!);
    const last = new Date(anchor.getTime() - (i % 7) * 1000),
      window = [1, 999, 1000, 60000, 86400000][i % 5]!;
    const offer = await db.offer.create({
      data: {
        productId: p.id,
        merchantId: m.id,
        externalProductId: String(i),
        isSynthetic: true,
        currentPrice: i % 11 === 0 || i % 17 === 0 ? null : price,
        referencePrice:
          i % 13 === 0 || i % 17 === 0
            ? null
            : Prisma.Decimal.min(
                price.plus('0.000001'),
                new Prisma.Decimal('999999999999999999.999999'),
              ),
        referencePriceTrusted: i % 4 !== 0,
        discountPercentage: 1,
        currency: i % 17 === 0 ? '' : 'USD',
        availability:
          i % 9 === 0 ? 'UNAVAILABLE' : i % 8 === 0 ? 'UNKNOWN' : 'AVAILABLE',
        lastUpdatedAt: last,
        staleAt: i % 19 === 0 ? null : new Date(last.getTime() + window),
        expiresAt: i % 6 === 0 ? new Date(anchor.getTime() + 1) : null,
        productUrl: i % 2 ? 'https://product.example.invalid/item' : null,
        shippingCost:
          i % 5 === 0
            ? null
            : i % 3 === 0
              ? '0'
              : price.div(2).toDecimalPlaces(6),
      },
    });
    ids.push(offer.id);
  }
});
after(async () => {
  if (merchantId) {
    await db.offer.deleteMany({ where: { merchantId } });
    await db.product.deleteMany({ where: { contentMerchantId: merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
  }
  await db.$disconnect();
});
test('optimized numeric scores and complete ordering equal legacy across weights and time boundaries', async () => {
  const rules = [
    defaultScoringRules,
    {
      ...defaultScoringRules,
      discountWeight: 10,
      freshnessWeight: 40,
      availabilityWeight: 10,
      qualityWeight: 20,
      shippingWeight: 20,
      discountCap: 73.25,
    },
  ];
  for (const r of rules)
    for (const delta of [-2000, 0, 1, 999, 1000, 60000, 86400000]) {
      const now = new Date(anchor.getTime() + delta),
        old = legacyDealScoreSql(now, r),
        next = dealScoreSql(now, r);
      const rows = await db.$queryRaw<
        { id: string; old: Prisma.Decimal; next: Prisma.Decimal }[]
      >(
        Prisma.sql`SELECT o.id,${old} AS old,${next} AS next FROM offers o JOIN products p ON p.id=o.product_id WHERE o.merchant_id=${merchantId}::uuid`,
      );
      for (const row of rows)
        assert.ok(
          row.old.eq(row.next),
          `${row.id} ${delta}: ${row.old} != ${row.next}`,
        );
      const legacyOrder = [...rows]
        .sort((a, b) => b.old.comparedTo(a.old) || a.id.localeCompare(b.id))
        .map((v) => v.id);
      const optimized = await db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT o.id FROM offers o JOIN products p ON p.id=o.product_id WHERE o.merchant_id=${merchantId}::uuid ORDER BY ${next} DESC,o.id ASC`,
      );
      assert.deepEqual(
        optimized.map((v) => v.id),
        legacyOrder,
      );
    }
});
test('generated factors update atomically on price/trust/shipping changes and remain read-only', async () => {
  const id = ids[1]!;
  await db.offer.update({
    where: { id },
    data: {
      currentPrice: '33.333333',
      referencePrice: '100',
      shippingCost: '1.234567',
      referencePriceTrusted: true,
      currency: 'USD',
      availability: 'AVAILABLE',
      lastUpdatedAt: anchor,
      staleAt: new Date(anchor.getTime() + 60000),
      expiresAt: null,
    },
  });
  let row = await db.offer.findUniqueOrThrow({
    where: { id },
    include: { product: true },
  });
  const [factors] = await db.$queryRaw<
    { discount: Prisma.Decimal; shipping: Prisma.Decimal }[]
  >`SELECT score_discount_percent AS discount,score_shipping_fraction AS shipping FROM offers WHERE id=${id}::uuid`;
  assert.ok(factors!.discount.gt(66));
  assert.ok(factors!.shipping.gt(0));
  await assert.rejects(
    db.$executeRaw`UPDATE offers SET score_discount_percent=100 WHERE id=${id}::uuid`,
  );
  await db.offer.update({
    where: { id },
    data: { referencePriceTrusted: false },
  });
  row = await db.offer.findUniqueOrThrow({
    where: { id },
    include: { product: true },
  });
  const [untrusted] = await db.$queryRaw<
    { discount: Prisma.Decimal }[]
  >`SELECT score_discount_percent AS discount FROM offers WHERE id=${id}::uuid`;
  assert.ok(untrusted!.discount.eq(0));
  const future = new Date(anchor.getTime() + 30000);
  const sql = await db.$queryRaw<{ score: Prisma.Decimal }[]>(
    Prisma.sql`SELECT ${dealScoreSql(future)} AS score FROM offers o JOIN products p ON p.id=o.product_id WHERE o.id=${id}::uuid`,
  );
  assert.equal(
    sql[0]!.score.toFixed(2),
    evaluateDeal({ ...row, imageUrl: row.product.imageUrl }, future).score,
  );
  await db.product.update({
    where: { id: row.productId },
    data: { imageUrl: null },
  });
  const updated = await db.$queryRaw<
    { old: Prisma.Decimal; next: Prisma.Decimal }[]
  >(
    Prisma.sql`SELECT ${legacyDealScoreSql(future)} AS old,${dealScoreSql(future)} AS next FROM offers o JOIN products p ON p.id=o.product_id WHERE o.id=${id}::uuid`,
  );
  assert.ok(updated[0]!.old.eq(updated[0]!.next));
});
test('optimized REST reads never reuse expired or stale scores', async () => {
  const id = ids[2]!,
    now = new Date();
  await db.offer.update({
    where: { id },
    data: {
      currentPrice: 10,
      referencePrice: 100,
      referencePriceTrusted: true,
      discountPercentage: 90,
      currency: 'USD',
      availability: 'AVAILABLE',
      lastUpdatedAt: now,
      staleAt: new Date(now.getTime() + 60000),
      expiresAt: new Date(now.getTime() + 60000),
    },
  });
  const catalog = new CatalogService(db, true),
    // Limit the fixture set: unrelated higher scores must not push the target
    // beyond page 1 and turn an expiry test into a pagination race.
    q = parseCatalogQuery({
      merchantId,
      currency: 'USD',
      view: 'top',
      q: 'SYNTHETIC optimization 2',
    });
  assert.ok((await catalog.deals(q)).data.some((v) => v.id === id));
  await db.offer.update({
    where: { id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  assert.ok(!(await catalog.deals(q)).data.some((v) => v.id === id));
  await db.offer.update({
    where: { id },
    data: { expiresAt: null, staleAt: new Date(Date.now() - 1) },
  });
  assert.ok(!(await catalog.deals(q)).data.some((v) => v.id === id));
});
test('cursor newest pages traverse equal timestamps without duplicates or COUNT and keep offset contract', async () => {
  const now = new Date();
  await db.offer.updateMany({
    where: { merchantId },
    data: {
      currentPrice: 10,
      referencePrice: 100,
      referencePriceTrusted: true,
      discountPercentage: 90,
      currency: 'USD',
      availability: 'AVAILABLE',
      lastUpdatedAt: new Date(now.getTime() - 1000),
      staleAt: new Date(now.getTime() + 60000),
      expiresAt: null,
    },
  });
  const catalog = new CatalogService(db, true),
    base = { merchantId, currency: 'USD', sort: 'newest', pageSize: '17' };
  const expected = (
    await catalog.deals(parseCatalogQuery({ ...base, pageSize: '100' }))
  ).data.map((v) => v.id);
  let token: string | undefined;
  const seen: string[] = [];
  for (let n = 0; n < 20; n++) {
    const result = await catalog.deals(
      parseCatalogQuery({
        ...base,
        pagination: 'cursor',
        ...(token ? { cursor: token } : {}),
      }),
    );
    assert.equal(result.pagination.total, null);
    seen.push(...result.data.map((v) => v.id));
    const pagination = result.pagination as {
      nextCursor?: string | null;
      hasMore?: boolean;
    };
    if (!pagination.hasMore) break;
    token = pagination.nextCursor!;
  }
  assert.equal(seen.length, 120);
  assert.equal(new Set(seen).size, 120);
  assert.deepEqual(seen.slice(0, 100), expected);
  const offset = await catalog.deals(parseCatalogQuery(base));
  assert.equal(offset.pagination.total, 120);
  assert.ok(token);
  await assert.rejects(
    catalog.deals(
      parseCatalogQuery({
        ...base,
        pagination: 'cursor',
        cursor: token,
        currency: 'EUR',
      }),
    ),
  );
  assert.throws(() =>
    parseCatalogQuery({ ...base, pagination: 'cursor', sort: 'score_desc' }),
  );
  assert.throws(() => parseCatalogQuery({ ...base, cursor: token }));
});

test('cursor pages revalidate expiry, consent and production synthetic exclusion on each request', async () => {
  const service = new CatalogService(db, true),
    q = parseCatalogQuery({
      merchantId,
      currency: 'USD',
      sort: 'newest',
      pageSize: '2',
      pagination: 'cursor',
    });
  const first = await service.deals(q),
    pagination = first.pagination as { nextCursor: string };
  const nextQuery = { ...q, cursor: pagination.nextCursor };
  const second = await service.deals(nextQuery),
    id = second.data[0]!.id;
  await db.offer.update({
    where: { id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  assert.ok(
    !(await service.deals(nextQuery)).data.some((row) => row.id === id),
  );
  await db.merchant.update({
    where: { id: merchantId },
    data: { storageAuthorized: false },
  });
  try {
    assert.equal((await service.deals(nextQuery)).data.length, 0);
  } finally {
    await db.merchant.update({
      where: { id: merchantId },
      data: { storageAuthorized: true },
    });
  }
  assert.equal((await new CatalogService(db, false).deals(q)).data.length, 0);
});

test('cursor crosses timestamp groups with stable UUID ties and no duplicate rows', async () => {
  const now = Date.now();
  await db.offer.updateMany({
    where: { id: { in: ids.slice(0, 40) } },
    data: {
      lastUpdatedAt: new Date(now - 3000),
      expiresAt: null,
      staleAt: new Date(now + 60000),
    },
  });
  await db.offer.updateMany({
    where: { id: { in: ids.slice(40, 80) } },
    data: {
      lastUpdatedAt: new Date(now - 2000),
      expiresAt: null,
      staleAt: new Date(now + 60000),
    },
  });
  await db.offer.updateMany({
    where: { id: { in: ids.slice(80) } },
    data: {
      lastUpdatedAt: new Date(now - 1000),
      expiresAt: null,
      staleAt: new Date(now + 60000),
    },
  });
  const service = new CatalogService(db, true),
    base = parseCatalogQuery({
      merchantId,
      currency: 'USD',
      sort: 'newest',
      pageSize: '19',
      pagination: 'cursor',
    });
  let cursor: string | undefined;
  const seen: string[] = [];
  for (let n = 0; n < 10; n++) {
    const result = await service.deals({
      ...base,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...result.data.map((row) => row.id));
    const p = result.pagination as { hasMore: boolean; nextCursor: string };
    if (!p.hasMore) break;
    cursor = p.nextCursor;
  }
  assert.equal(seen.length, 120);
  assert.equal(new Set(seen).size, 120);
  const expected = await db.offer.findMany({
    where: { merchantId },
    orderBy: [{ lastUpdatedAt: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  assert.deepEqual(
    seen,
    expected.map((row) => row.id),
  );
});
