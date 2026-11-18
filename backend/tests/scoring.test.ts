import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateDeal,
  parseScoringRules,
  type ScoreInput,
} from '../src/scoring/deal-scoring.js';
import {
  assertDemoWorkerEnabled,
  parseWorkerEnvironment,
} from '../src/config/worker.js';
import { MockStoreProvider } from '../src/providers/mock-store-provider.js';

const now = new Date('2026-11-18T12:00:00.000Z');
const input: ScoreInput = {
  currentPrice: '50',
  referencePrice: '100',
  referencePriceTrusted: true,
  currency: 'USD',
  availability: 'AVAILABLE',
  lastUpdatedAt: now,
  staleAt: new Date(now.getTime() + 7200000),
  expiresAt: null,
  shippingCost: '0',
  productUrl: 'https://fixture.example.invalid/item',
  imageUrl: 'https://fixture.example.invalid/image',
};

test('scoring explains a maximum score and caps the discount contribution', () => {
  const score = evaluateDeal(input, now);
  assert.equal(score.score, '100.00');
  assert.equal(score.components.discount, '35');
  assert.equal(score.classification, 'TOP_DEAL');
  assert.equal(
    evaluateDeal({ ...input, currentPrice: '1' }, now).components.discount,
    '35',
  );
});
test('untrusted reference never earns discount points or a top-deal label', () => {
  const score = evaluateDeal({ ...input, referencePriceTrusted: false }, now);
  assert.equal(score.components.discount, '0');
  assert.equal(score.classification, 'PRODUCT');
  assert.ok(score.reasons.includes('UNTRUSTED_REFERENCE'));
});
test('freshness decays with time and stale/expired/unavailable offers score zero', () => {
  assert.equal(
    evaluateDeal(input, new Date(now.getTime() + 3600000)).components.freshness,
    '12.5',
  );
  for (const changed of [
    { staleAt: now },
    { staleAt: null },
    { expiresAt: now },
    { availability: 'UNAVAILABLE' },
  ]) {
    assert.equal(evaluateDeal({ ...input, ...changed }, now).score, '0.00');
  }
});
test('shipping unknown earns no free-shipping points; shipping cost lowers score', () => {
  assert.equal(
    evaluateDeal({ ...input, shippingCost: null }, now).components.shipping,
    '0',
  );
  assert.equal(
    evaluateDeal({ ...input, shippingCost: '25' }, now).components.shipping,
    '5',
  );
  assert.equal(
    evaluateDeal({ ...input, shippingCost: '100' }, now).components.shipping,
    '0',
  );
});
test('invalid or absent price/reference, unknown availability and missing metadata are conservative', () => {
  for (const changed of [
    { currentPrice: null },
    { currentPrice: '-1' },
    { currency: '' },
  ])
    assert.equal(evaluateDeal({ ...input, ...changed }, now).score, '0.00');
  for (const referencePrice of [null, '0', '49'])
    assert.equal(
      evaluateDeal({ ...input, referencePrice }, now).components.discount,
      '0',
    );
  assert.equal(
    evaluateDeal({ ...input, availability: 'UNKNOWN' }, now).classification,
    'DISCOUNTED_PRODUCT',
  );
  assert.equal(
    evaluateDeal({ ...input, imageUrl: null, productUrl: null }, now).components
      .quality,
    '0',
  );
});
test('scoring weights are configurable and invalid configurations fail closed', () => {
  const rules = parseScoringRules(
    '{"discountWeight":0,"freshnessWeight":60,"availabilityWeight":20,"qualityWeight":10,"shippingWeight":10}',
  );
  assert.equal(evaluateDeal(input, now, rules).components.discount, '0');
  assert.throws(() => parseScoringRules('{"discountWeight":100}'));
  assert.throws(() => parseScoringRules('broken'));
});
test('worker is disabled by default and synthetic execution cannot be enabled in production', () => {
  const defaults = parseWorkerEnvironment({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.allowSynthetic, false);
  assert.throws(() => assertDemoWorkerEnabled('development', defaults));
  const enabled = parseWorkerEnvironment({
    WORKER_ENABLED: 'true',
    WORKER_ALLOW_SYNTHETIC: 'true',
  });
  assert.throws(() => assertDemoWorkerEnabled('production', enabled));
  assert.doesNotThrow(() => assertDemoWorkerEnabled('test', enabled));
  assert.throws(() => parseWorkerEnvironment({ WORKER_MAX_PRODUCTS: '0' }));
});
test('MockStoreProvider is clearly synthetic, page-aware and has no external images', async () => {
  const provider = new MockStoreProvider('SYNTHETIC Unit Store');
  const page = await provider.searchProducts({ pageSize: 2, page: 2 });
  assert.equal(page.products.length, 2);
  assert.equal(page.totalPages, 3);
  assert.ok(
    page.products.every(
      (row) => row.name.includes('SYNTHETIC') && !row.imageUrl,
    ),
  );
  assert.equal(
    (await provider.searchProducts({ pageSize: 20, discountedOnly: true }))
      .products.length,
    4,
  );
});
