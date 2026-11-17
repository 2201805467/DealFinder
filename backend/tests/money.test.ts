import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { OfferIngestionService } from '../src/services/offer-ingestion.js';
import { AppError } from '../src/utils/app-error.js';
import { exactMoney, calculatedDiscount } from '../src/services/money.js';
import { parseCatalogQuery } from '../src/services/catalog-query.js';
import {
  assertDevelopmentDatabase,
  assertTestDatabase,
} from '../src/database/development-guard.js';

test('money uses decimal arithmetic and rejects unprocessed binary-float artifacts', () => {
  assert.equal(exactMoney('0.10')?.plus(exactMoney('0.20')!).toFixed(), '0.3');
  assert.equal(exactMoney(1.234567)?.toFixed(), '1.234567');
  assert.equal(
    calculatedDiscount(exactMoney('99.99'), exactMoney('129.99'))?.toFixed(),
    '23.08',
  );
  assert.equal(
    calculatedDiscount(exactMoney(0), exactMoney(10))?.toFixed(),
    '100',
  );
  assert.equal(calculatedDiscount(exactMoney(0), exactMoney(0)), null);
  for (const invalid of [0.1 + 0.2, -1, NaN, Infinity, '1.0000001', '1e3'])
    assert.throws(() => exactMoney(invalid));
});

test('catalog validates currency comparisons, bounds and identifiers in query strings', () => {
  for (const invalid of [
    { minPrice: '1' },
    { sort: 'price_asc' },
    { page: '0' },
    { pageSize: '101' },
    { minPrice: '-1' },
    { currency: 'usd' },
    { merchantId: 'bad' },
    { q: ['a', 'b'] },
    { unknown: 'ignored' },
  ]) {
    assert.throws(() => parseCatalogQuery(invalid));
  }
  assert.equal(
    parseCatalogQuery({ currency: 'USD', sort: 'price_asc' }).currency,
    'USD',
  );
});

test('synthetic seed/test guards prevent production, remote and development database reuse', () => {
  assert.throws(() =>
    assertDevelopmentDatabase(
      'production',
      'postgresql://localhost/dealfinder',
    ),
  );
  assert.throws(() =>
    assertDevelopmentDatabase(
      'development',
      'postgresql://remote.example/dealfinder',
    ),
  );
  assert.throws(() =>
    assertTestDatabase(
      'postgresql://localhost/dealfinder',
      'postgresql://localhost/dealfinder',
    ),
  );
  assert.throws(() =>
    assertTestDatabase(
      'postgresql://localhost/example_test',
      'postgresql://localhost/example_test',
    ),
  );
  assert.equal(
    assertTestDatabase(
      'postgresql://localhost/dealfinder_test',
      'postgresql://localhost/dealfinder',
    ),
    'postgresql://localhost/dealfinder_test',
  );
});

test('invalid provider URLs are rejected safely before any database access', async () => {
  const service = new OfferIngestionService({} as PrismaClient, 'test');
  await assert.rejects(
    service.ingest(randomUUID(), [
      {
        product: {
          externalId: 'invalid-url',
          name: 'TEST',
          store: 'TEST',
          fetchedAt: new Date().toISOString(),
          productUrl: 'not a valid URL',
        },
      },
    ]),
    (error: unknown) =>
      error instanceof AppError && error.code === 'INVALID_INPUT',
  );
});
