import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CheapSharkProvider,
  cheapSharkLink,
  normalizeCheapShark,
} from '../src/providers/cheapshark/cheapshark-provider.js';
import {
  GamerPowerProvider,
  conservativeGiveawayEnd,
  normalizeGamerPower,
} from '../src/providers/gamerpower/gamerpower-provider.js';
import { SourceHttpClient } from '../src/providers/source-http.js';
import { ProviderError } from '../src/providers/provider-error.js';
import {
  parseWorkerEnvironment,
  assertRealWorkerEnabled,
} from '../src/config/worker.js';
import { evaluateDeal } from '../src/scoring/deal-scoring.js';
import { Prisma } from '../src/generated/prisma/client.js';
import type { Merchant } from '../src/generated/prisma/client.js';
import {
  demoRegistry,
  realRegistry,
} from '../src/services/provider-registry.js';

// Entirely synthetic fixtures shaped like documented API responses; no live HTTP.
const now = new Date().toISOString();
test('source reconfiguration cannot reuse a provider from a different source or stale store name', () => {
  const merchant = {
    id: 'test-only-registry',
    name: 'TEST ONLY old name',
    sourceType: 'CHEAPSHARK',
    isSynthetic: false,
    websiteUrl: 'https://www.cheapshark.com/',
  } as Merchant;
  const registry = realRegistry();
  assert.equal(registry.resolve(merchant)?.name, 'CheapShark');
  assert.equal(
    registry.resolve({
      ...merchant,
      sourceType: 'GAMERPOWER',
      websiteUrl: 'https://www.gamerpower.com/',
    })?.name,
    'GamerPower',
  );
  const demo = demoRegistry();
  const fixture = {
    ...merchant,
    sourceType: 'SYNTHETIC' as const,
    isSynthetic: true,
  };
  assert.equal(demo.resolve(fixture)?.name, fixture.name);
  assert.equal(
    demo.resolve({ ...fixture, name: 'TEST ONLY changed name' })?.name,
    'TEST ONLY changed name',
  );
});
const deal = {
  gameID: '123',
  dealID: 'abc%2Fdef%2Bxyz%3D',
  storeID: '1',
  title: 'TEST ONLY game',
  salePrice: '3.49',
  normalPrice: '69.99',
  isOnSale: '1',
  thumb: 'https://images.example.invalid/test.jpg',
};
const giveaway = {
  id: 123,
  title: 'TEST ONLY giveaway',
  description: 'Synthetic fixture',
  image: 'https://images.example.invalid/test.jpg',
  open_giveaway_url: 'https://www.gamerpower.com/open/test-fixture',
  platforms: 'PC, Steam',
  type: 'Game',
  status: 'Active',
  end_date: '2099-12-31 23:59:00',
  worth: '$99.99',
};
const stores = new Map([['1', 'TEST ONLY retailer']]);
test('live-observed GamerPower DLC/Other labels remain distinct from full games', () => {
  assert.equal(
    normalizeGamerPower({ ...giveaway, type: 'DLC' }, now)?.source?.kind,
    'dlc',
  );
  assert.equal(
    normalizeGamerPower({ ...giveaway, type: 'Other' }, now)?.source?.kind,
    'giveaway',
  );
});
const json = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { headers });
test('CheapShark normalization uses actual retailer and stable game ID; Decimal discount not upstream rating', () => {
  const p = normalizeCheapShark(
    { ...deal, savings: '999', dealRating: '10' },
    stores,
    now,
  )!;
  assert.equal(p.externalId, '123');
  assert.equal(p.store, 'TEST ONLY retailer');
  assert.equal(p.discountPercentage, 95.01);
  assert.equal(p.market, undefined);
  assert.equal(p.source?.referencePriceTrusted, true);
  assert.equal(p.originalPrice, 69.99);
  assert.equal(p.currency, 'USD');
});
test('CheapShark redirect decodes exactly once and never double-encodes API deal ID', () => {
  const url = new URL(cheapSharkLink(deal.dealID));
  assert.equal(url.origin, 'https://www.cheapshark.com');
  assert.equal(url.searchParams.get('dealID'), 'abc/def+xyz=');
  assert.throws(() => cheapSharkLink('%invalid'), ProviderError);
});
test('CheapShark missing/invalid prices are skipped; invalid references do not fabricate savings', () => {
  for (const salePrice of [undefined, '-1.00', 'NaN', '999999999999999.00'])
    assert.equal(
      normalizeCheapShark({ ...deal, salePrice }, stores, now),
      undefined,
    );
  for (const normalPrice of ['1.00', '3.49', undefined]) {
    const p = normalizeCheapShark({ ...deal, normalPrice }, stores, now)!;
    assert.equal(p.originalPrice, undefined);
    assert.equal(p.discountPercentage, undefined);
    assert.equal(p.source?.referencePriceTrusted, false);
  }
  assert.equal(normalizeCheapShark(deal, new Map(), now), undefined);
});
test('CheapShark official pages, title/onSale filters, stores caching and unknown total', async () => {
  const urls: URL[] = [];
  let count = 0;
  const http = new SourceHttpClient(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return url.pathname.endsWith('/stores')
      ? json([{ storeID: '1', storeName: 'TEST ONLY retailer', isActive: 1 }])
      : json([deal], { 'x-total-page-count': '3' });
  }, 0);
  const provider = new CheapSharkProvider(http);
  const a = await provider.searchProducts(
    { query: 'TEST', discountedOnly: true, pageSize: 1, page: 2 },
    {
      onRequest: async () => {
        count++;
      },
    },
  );
  await provider.searchProducts({ pageSize: 1, page: 3 });
  assert.equal(a.total, undefined);
  assert.equal(a.totalPages, 3);
  assert.equal(a.page, 2);
  assert.equal(urls.length, 3);
  assert.equal(count, 2);
  assert.equal(urls[1]!.searchParams.get('pageNumber'), '1');
  assert.equal(urls[1]!.searchParams.get('title'), 'TEST');
  assert.equal(urls[1]!.searchParams.get('onSale'), '1');
  await assert.rejects(provider.searchProducts({ pageSize: 61 }), {
    code: 'INVALID_SEARCH',
  });
});
test('GamerPower Free is not a 100% discount and worth is never trusted', () => {
  for (const worth of ['$99.99', 'N/A', 'invalid', undefined]) {
    const p = normalizeGamerPower({ ...giveaway, worth }, now)!;
    assert.equal(p.currentPrice, 0);
    assert.equal(p.originalPrice, undefined);
    assert.equal(p.discountPercentage, undefined);
    assert.equal(p.store, 'Giveaway publisher not specified');
    assert.deepEqual(p.source?.platforms, ['PC', 'Steam']);
    assert.equal(p.market, undefined);
    const score = evaluateDeal({
      currentPrice: new Prisma.Decimal(0),
      referencePrice: null,
      referencePriceTrusted: false,
      productUrl: p.productUrl ?? null,
      shippingCost: null,
      availability: 'AVAILABLE',
      lastUpdatedAt: new Date(now),
      staleAt: new Date(Date.now() + 600000),
      expiresAt: null,
      imageUrl: p.imageUrl ?? null,
      currency: 'USD',
    });
    assert.notEqual(score.classification, 'TOP_DEAL');
  }
});
test('GamerPower expiry is conservative, unknown date stays unknown, invalid/expired offers excluded', () => {
  assert.equal(
    conservativeGiveawayEnd('2026-11-20 23:59:00'),
    '2026-11-20T09:59:00.000Z',
  );
  assert.equal(conservativeGiveawayEnd('2026-02-30 12:00:00'), undefined);
  assert.equal(
    normalizeGamerPower({ ...giveaway, end_date: '2000-01-01 00:00:00' }, now),
    undefined,
  );
  assert.equal(
    normalizeGamerPower({ ...giveaway, status: 'Expired' }, now),
    undefined,
  );
  assert.equal(
    normalizeGamerPower({ ...giveaway, end_date: 'bad' }, now),
    undefined,
  );
  assert.equal(
    normalizeGamerPower({ ...giveaway, end_date: 'N/A' }, now)?.source?.endsAt,
    undefined,
  );
  assert.equal(
    normalizeGamerPower(
      { ...giveaway, open_giveaway_url: 'https://evil.example/open/test' },
      now,
    ),
    undefined,
  );
});
test('GamerPower pages slice one feed snapshot, fresh runs refetch; loot is not a full game', async () => {
  let requests = 0;
  const provider = new GamerPowerProvider(
    new SourceHttpClient(async () => {
      requests++;
      return json([
        giveaway,
        { ...giveaway, id: 124, title: 'TEST loot', type: 'Loot' },
      ]);
    }, 0),
  );
  const a = await provider.searchProducts({ pageSize: 1, page: 1 });
  const b = await provider.searchProducts({ pageSize: 1, page: 2 });
  assert.equal(requests, 1);
  assert.equal(a.total, 2);
  assert.equal(b.products[0]!.source?.kind, 'loot');
  assert.equal(a.products[0]!.fetchedAt, b.products[0]!.fetchedAt);
  assert.equal(
    (await provider.searchProducts({ query: 'loot' })).products.length,
    1,
  );
  provider.beginRun();
  await provider.searchProducts();
  assert.equal(requests, 2);
  assert.deepEqual(
    (await provider.searchProducts({ discountedOnly: true })).products,
    [],
  );
  assert.equal(requests, 2);
  const empty = await new GamerPowerProvider(
    new SourceHttpClient(async () => new Response('{}', { status: 201 }), 0),
  ).searchProducts();
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.products, []);
});
test('shared source HTTP handles 429/Retry-After, safe upstream errors, malformed JSON and network failure', async () => {
  for (const [status, code] of [
    [429, 'RATE_LIMIT'],
    [503, 'UPSTREAM'],
    [403, 'ACCESS_OR_QUOTA'],
  ] as const) {
    await assert.rejects(
      new SourceHttpClient(
        async () =>
          new Response('PRIVATE PAYLOAD', {
            status,
            headers: { 'retry-after': '12' },
          }),
        0,
      ).get(new URL('https://www.gamerpower.com/api/giveaways')),
      (e: unknown) =>
        e instanceof ProviderError &&
        e.code === code &&
        !e.message.includes('PRIVATE') &&
        (status !== 429 || e.retryAfterSeconds === 12),
    );
  }
  await assert.rejects(
    new SourceHttpClient(async () => {
      throw new Error('private');
    }, 0).get(new URL('https://www.gamerpower.com/api/giveaways')),
    { code: 'NETWORK' },
  );
  await assert.rejects(
    new SourceHttpClient(async () => new Response('bad json'), 0).get(
      new URL('https://www.gamerpower.com/api/giveaways'),
    ),
    { code: 'INVALID_RESPONSE' },
  );
});
test('HTTP timeout, spacing, aborted request, and callback budgets are enforced without retries', async () => {
  const abortable: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      ),
    );
  await assert.rejects(
    new SourceHttpClient(abortable, 0, 20).get(
      new URL('https://www.gamerpower.com/api/giveaways'),
    ),
    { code: 'TIMEOUT' },
  );
  let calls = 0;
  const client = new SourceHttpClient(async () => {
    calls++;
    return json([]);
  }, 30);
  const started = Date.now();
  await client.get(new URL('https://www.gamerpower.com/api/giveaways'));
  await client.get(new URL('https://www.gamerpower.com/api/giveaways'));
  assert.ok(Date.now() - started >= 25);
  assert.equal(calls, 2);
  const budget = new Error('BUDGET');
  await assert.rejects(
    client.get(new URL('https://www.gamerpower.com/api/giveaways'), {
      onRequest: async () => {
        throw budget;
      },
    }),
    (e) => e === budget,
  );
  assert.equal(calls, 2);
});
test('real source flags default off, synthetic/real modes cannot mix in production', () => {
  const defaults = parseWorkerEnvironment({});
  assert.equal(defaults.cheapSharkEnabled, false);
  assert.equal(defaults.gamerPowerEnabled, false);
  assert.throws(() => assertRealWorkerEnabled('production', defaults));
  const real = parseWorkerEnvironment({
    WORKER_ENABLED: 'true',
    GAMERPOWER_ENABLED: 'true',
  });
  assert.doesNotThrow(() => assertRealWorkerEnabled('production', real));
  assert.throws(() =>
    assertRealWorkerEnabled('production', { ...real, allowSynthetic: true }),
  );
});
