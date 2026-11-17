// All responses and credentials in this file are synthetic test fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBestBuyEnvironment } from '../src/config/bestbuy.js';
import { BestBuyProvider } from '../src/providers/bestbuy/bestbuy-provider.js';
import { normalizeBestBuyProduct } from '../src/providers/bestbuy/normalize.js';
import { ProviderError } from '../src/providers/provider-error.js';

const fetchedAt = '2026-11-16T12:00:00.000Z';
const key = 'mock-key-for-unit-tests-only';
const product = {
  sku: 12345,
  name: 'MOCK hardware product',
  type: 'HardGood',
  shortDescription: 'Synthetic fixture, not a real offer',
  image: 'https://example.com/mock-image.jpg',
  url: 'https://example.com/mock-product',
  salePrice: 75,
  regularPrice: 100,
  onSale: true,
  onlineAvailability: true,
  priceRestriction: null,
};
function collection(products: unknown[] = [product]) {
  return {
    products,
    total: products.length,
    totalPages: products.length ? 1 : 0,
    currentPage: 1,
    partial: false,
  };
}
function provider(fetch: typeof globalThis.fetch, timeoutMs = 1000) {
  return new BestBuyProvider({ apiKey: key, fetch, timeoutMs });
}
function errorCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, code);
    assert.ok(!String(error.stack).includes(key));
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('MOCK: normalizes identity, optional details, source context and retrieval time', () => {
  assert.deepEqual(normalizeBestBuyProduct(product, fetchedAt), {
    externalId: '12345',
    store: 'Best Buy',
    name: product.name,
    description: product.shortDescription,
    imageUrl: product.image,
    productUrl: product.url,
    currentPrice: 75,
    originalPrice: 100,
    discountPercentage: 25,
    availability: 'available',
    currency: 'USD',
    market: 'US',
    priceRestricted: false,
    fetchedAt,
  });
});

test('MOCK: computes rounded savings only from valid prices and an onSale flag', () => {
  assert.equal(
    normalizeBestBuyProduct(
      { ...product, salePrice: 2, regularPrice: 3 },
      fetchedAt,
    )?.discountPercentage,
    33.33,
  );
  for (const change of [
    { onSale: false },
    { onSale: undefined },
    { regularPrice: 75 },
    { regularPrice: 50 },
    { regularPrice: null },
  ]) {
    assert.equal(
      normalizeBestBuyProduct({ ...product, ...change }, fetchedAt)
        ?.discountPercentage,
      undefined,
    );
  }
});

test('MOCK: missing or invalid prices remain absent, never zero or a fabricated discount', () => {
  for (const price of [undefined, null, -1, 0, '75', NaN, Infinity]) {
    const normalized = normalizeBestBuyProduct(
      { ...product, salePrice: price },
      fetchedAt,
    );
    assert.ok(normalized);
    assert.equal(normalized.currentPrice, undefined);
    assert.equal(normalized.discountPercentage, undefined);
    assert.ok(!('currentPrice' in normalized));
    assert.equal(
      normalizeBestBuyProduct({ ...product, regularPrice: price }, fetchedAt)
        ?.originalPrice,
      undefined,
    );
  }
});

test('MOCK: restricted or unconfirmed prices are withheld, including reference prices', () => {
  for (const restriction of ['MAP', 'ICR', 'unknown-restriction', undefined]) {
    const normalized = normalizeBestBuyProduct(
      { ...product, priceRestriction: restriction },
      fetchedAt,
    );
    assert.ok(normalized);
    assert.equal(normalized.priceRestricted, true);
    assert.equal(normalized.currentPrice, undefined);
    assert.equal(normalized.originalPrice, undefined);
    assert.equal(normalized.discountPercentage, undefined);
  }
});

test('MOCK: missing optional fields and online availability are not invented', () => {
  const normalized = normalizeBestBuyProduct(
    { sku: 1, name: 'MOCK', type: 'HardGood', priceRestriction: '' },
    fetchedAt,
  );
  assert.ok(normalized);
  for (const field of [
    'imageUrl',
    'productUrl',
    'description',
    'availability',
    'currentPrice',
  ]) {
    assert.ok(!(field in normalized));
  }
  assert.equal(
    normalizeBestBuyProduct(
      { ...product, onlineAvailability: false },
      fetchedAt,
    )?.availability,
    'unavailable',
  );
});

test('MOCK: skips invalid identities and content outside hardware scope', () => {
  for (const input of [
    null,
    {},
    { ...product, sku: -1 },
    { ...product, name: '' },
    { ...product, type: 'Game' },
    { ...product, type: 'Bundle' },
  ]) {
    assert.equal(normalizeBestBuyProduct(input, fetchedAt), undefined);
  }
});

test('MOCK: builds an official search for discounted hardware with a result limit', async () => {
  const client = provider(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.bestbuy.com');
    assert.match(
      decodeURIComponent(url.pathname),
      /type=HardGood&active=true&onSale=true&search=usb&search=c/,
    );
    assert.equal(url.searchParams.get('pageSize'), '20');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('apiKey'), key);
    assert.equal(init?.redirect, 'error');
    return Response.json({
      ...collection(),
      currentPage: 2,
      totalPages: 3,
      total: 50,
    });
  });
  const result = await client.searchProducts({
    query: 'usb c',
    discountedOnly: true,
    pageSize: 20,
    page: 2,
  });
  assert.equal(result.page, 2);
  assert.equal(result.total, 50);
  assert.equal(result.products.length, 1);
  assert.ok(!JSON.stringify(result).includes(key));
});

test('MOCK: cursor pagination encodes tokens and preserves progress over skipped records', async () => {
  const cursor = 'a+/=';
  const result = await provider(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('cursorMark'), cursor);
    assert.equal(url.searchParams.has('page'), false);
    return Response.json({ ...collection([{}]), nextCursorMark: 'next+/=' });
  }).searchProducts({ cursor });
  assert.equal(result.page, undefined);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.nextCursor, 'next+/=');
});

test('MOCK: rejects filter injection, out-of-range limits and mixed pagination before network access', async () => {
  const client = provider(async () => {
    throw new Error('Network must not be called');
  });
  for (const input of [
    { query: 'a&onSale=false' },
    { pageSize: 101 },
    { pageSize: 0 },
    { page: 11 },
    { cursor: '*', page: 1 },
  ]) {
    await assert.rejects(
      client.searchProducts(input),
      errorCode('INVALID_SEARCH'),
    );
  }
});

test('MOCK: an empty response returns no fabricated offers', async () => {
  const result = await provider(async () =>
    Response.json(collection([])),
  ).searchProducts();
  assert.deepEqual(result.products, []);
  assert.equal(result.total, 0);
  assert.equal(result.skippedCount, 0);
});

test('MOCK: malformed envelopes/JSON are rejected without exposing response contents', async () => {
  for (const response of [
    Response.json({ canonicalUrl: key }),
    new Response(key),
  ]) {
    await assert.rejects(
      provider(async () => response).searchProducts(),
      errorCode('INVALID_RESPONSE'),
    );
  }
});

test('MOCK: 403 is ambiguous access/quota failure and never retried automatically', async () => {
  let calls = 0;
  await assert.rejects(
    provider(async () => {
      calls++;
      return new Response(key, { status: 403 });
    }).searchProducts(),
    errorCode('ACCESS_OR_QUOTA'),
  );
  assert.equal(calls, 1);
});

test('MOCK: 429 honors Retry-After and blocks another call during cooldown', async () => {
  let calls = 0;
  const client = provider(async () => {
    calls++;
    return new Response(key, { status: 429, headers: { 'Retry-After': '30' } });
  });
  await assert.rejects(client.searchProducts(), (error: unknown) => {
    errorCode('RATE_LIMIT')(error);
    assert.equal((error as ProviderError).retryAfterSeconds, 30);
    return true;
  });
  await assert.rejects(client.searchProducts(), errorCode('RATE_LIMIT'));
  assert.equal(calls, 1);
});

test('MOCK: server and network failures never propagate API keys or raw causes', async () => {
  await assert.rejects(
    provider(async () => new Response(key, { status: 503 })).searchProducts(),
    errorCode('UPSTREAM'),
  );
  await assert.rejects(
    provider(async () => {
      throw new Error(`Failed URL ?apiKey=${key}`);
    }).searchProducts(),
    errorCode('NETWORK'),
  );
});

test('MOCK: request timeout aborts the transport and produces a safe error', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      provider(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error(key)),
              { once: true },
            );
          }),
        100,
      ).searchProducts(),
      errorCode('TIMEOUT'),
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test('MOCK: missing credentials do not affect health but prevent provider construction', () => {
  assert.throws(() => parseBestBuyEnvironment({}), errorCode('CONFIGURATION'));
  assert.throws(
    () => new BestBuyProvider({ apiKey: '' }),
    errorCode('CONFIGURATION'),
  );
  assert.deepEqual(parseBestBuyEnvironment({ BESTBUY_API_KEY: key }), {
    apiKey: key,
    timeoutMs: 10000,
  });
  assert.throws(
    () =>
      parseBestBuyEnvironment({
        BESTBUY_API_KEY: key,
        BESTBUY_TIMEOUT_MS: '-1',
      }),
    errorCode('CONFIGURATION'),
  );
});
