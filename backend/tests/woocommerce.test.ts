// Synthetic fixtures model the official Store API, not an external store's data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { parseWooCommerceEnvironment } from '../src/config/woocommerce.js';
import {
  minorUnitAmount,
  normalizeWooCommerceProduct,
} from '../src/providers/woocommerce/normalize.js';
import { WooCommerceProvider } from '../src/providers/woocommerce/woocommerce-provider.js';
import { ProviderError } from '../src/providers/provider-error.js';

const stamp = '2026-11-17T10:00:00.000Z';
const product = {
  id: 101,
  name: 'MOCK Local Product',
  type: 'simple',
  permalink: 'http://127.0.0.1:8088/product/mock',
  short_description: '<p>Synthetic description</p>',
  on_sale: true,
  prices: {
    price: '9999',
    regular_price: '12999',
    sale_price: '9999',
    currency_code: 'USD',
    currency_minor_unit: 2,
    price_range: null,
  },
  images: [{ src: 'http://127.0.0.1:8088/mock.png' }],
  is_in_stock: true,
  is_purchasable: true,
};
const config = {
  baseUrl: 'http://127.0.0.1:8088',
  storeName: 'MOCK Store',
  usage: 'local-test' as const,
};
const headers = { 'X-WP-Total': '1', 'X-WP-TotalPages': '1' };
function client(fetch: typeof globalThis.fetch, timeoutMs = 1000) {
  return new WooCommerceProvider({ ...config, fetch, timeoutMs });
}
function code(expected: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, expected);
    assert.ok(!String(error.stack).includes('sensitive-test-content'));
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('MOCK WooCommerce: converts integer minor units for zero, two, three and six decimal currencies', () => {
  assert.equal(minorUnitAmount('1025', 0), 1025);
  assert.equal(minorUnitAmount('10025', 2), 100.25);
  assert.equal(minorUnitAmount('12345', 3), 12.345);
  assert.equal(minorUnitAmount('1234567', 6), 1.234567);
  assert.equal(minorUnitAmount('0', 2), 0);
});

test('MOCK WooCommerce: rejects missing, decimal, negative, unsafe and malformed minor-unit amounts', () => {
  assert.equal(minorUnitAmount('9007199254740991', 6), undefined);
  for (const value of [
    undefined,
    null,
    '',
    '-1',
    '12.99',
    '1e3',
    'NaN',
    '9007199254740992',
    100,
    ' 100 ',
  ]) {
    assert.equal(minorUnitAmount(value, 2), undefined);
  }
  for (const minor of [undefined, '2', -1, 1.5, 7, NaN])
    assert.equal(minorUnitAmount('100', minor), undefined);
});

test('MOCK WooCommerce: maps the current price, reference price, currency and trustworthy computed discount', () => {
  const normalized = normalizeWooCommerceProduct(product, 'MOCK Store', stamp);
  assert.deepEqual(normalized, {
    externalId: '101',
    store: 'MOCK Store',
    name: product.name,
    fetchedAt: stamp,
    description: product.short_description,
    imageUrl: product.images[0]?.src,
    productUrl: product.permalink,
    currentPrice: 99.99,
    originalPrice: 129.99,
    discountPercentage: 23.08,
    currency: 'USD',
    availability: 'available',
  });
});

test('MOCK WooCommerce: uses price rather than a stale sale_price; never invents a discount', () => {
  for (const changed of [
    { on_sale: false },
    { prices: { ...product.prices, sale_price: '8000' } },
    { prices: { ...product.prices, regular_price: '9000' } },
    { prices: { ...product.prices, regular_price: '9999' } },
    { prices: { ...product.prices, price: '' } },
  ])
    assert.equal(
      normalizeWooCommerceProduct({ ...product, ...changed }, 'MOCK', stamp)
        ?.discountPercentage,
      undefined,
    );
  assert.equal(
    normalizeWooCommerceProduct(
      {
        ...product,
        prices: { ...product.prices, price: '0', sale_price: '0' },
      },
      'MOCK',
      stamp,
    )?.discountPercentage,
    100,
  );
});

test('MOCK WooCommerce: range, variable and grouped products do not mix unrelated variant prices', () => {
  for (const changed of [
    { type: 'variable' },
    { type: 'grouped' },
    { type: undefined },
    {
      prices: {
        ...product.prices,
        price_range: { min_amount: '9999', max_amount: '19999' },
      },
    },
  ]) {
    const normalized = normalizeWooCommerceProduct(
      { ...product, ...changed },
      'MOCK',
      stamp,
    );
    assert.ok(normalized);
    assert.equal(normalized.currentPrice, undefined);
    assert.equal(normalized.originalPrice, undefined);
    assert.equal(normalized.discountPercentage, undefined);
  }
});

test('MOCK WooCommerce: incomplete currency/unit or absent prices never become a numeric price', () => {
  for (const prices of [
    undefined,
    {},
    { ...product.prices, currency_minor_unit: undefined },
    { ...product.prices, currency_code: undefined },
  ]) {
    assert.equal(
      normalizeWooCommerceProduct({ ...product, prices }, 'MOCK', stamp)
        ?.currentPrice,
      undefined,
    );
  }
});

test('MOCK WooCommerce: availability needs explicit purchase/stock data, and market is not inferred', () => {
  assert.equal(
    normalizeWooCommerceProduct(
      { ...product, is_in_stock: false },
      'MOCK',
      stamp,
    )?.availability,
    'unavailable',
  );
  const normalized = normalizeWooCommerceProduct(
    { ...product, is_purchasable: undefined },
    'MOCK',
    stamp,
  );
  assert.equal(normalized?.availability, undefined);
  assert.equal(normalized?.market, undefined);
  assert.equal(
    normalizeWooCommerceProduct({ ...product, id: -1 }, 'MOCK', stamp),
    undefined,
  );
});

test('MOCK WooCommerce: search/on-sale/pagination use official query parameters and response totals', async () => {
  const result = await client(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/wp-json/wc/store/v1/products');
    assert.equal(url.searchParams.get('on_sale'), 'true');
    assert.equal(url.searchParams.get('search'), 'cable & adapter');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('per_page'), '5');
    assert.equal(init?.redirect, 'error');
    return Response.json([product, {}], {
      headers: { 'X-WP-Total': '8', 'X-WP-TotalPages': '2' },
    });
  }).searchProducts({
    query: 'cable & adapter',
    discountedOnly: true,
    page: 2,
    pageSize: 5,
  });
  assert.equal(result.total, 8);
  assert.equal(result.totalPages, 2);
  assert.equal(result.page, 2);
  assert.equal(result.products.length, 1);
  assert.equal(result.skippedCount, 1);
});

test('MOCK WooCommerce: empty pages retain totals without fabricated results', async () => {
  const result = await client(async () =>
    Response.json([], {
      headers: { 'X-WP-Total': '0', 'X-WP-TotalPages': '0' },
    }),
  ).searchProducts();
  assert.deepEqual(result.products, []);
  assert.equal(result.total, 0);
  assert.equal(result.totalPages, 0);
});

test('MOCK WooCommerce: rejects missing pagination metadata and malformed JSON/envelopes', async () => {
  for (const response of [
    Response.json([product]),
    Response.json({}, { headers }),
    new Response('sensitive-test-content'),
  ]) {
    await assert.rejects(
      client(async () => response).searchProducts(),
      code('INVALID_RESPONSE'),
    );
  }
});

test('MOCK WooCommerce: invalid searches are rejected before transport', async () => {
  const provider = client(async () => {
    throw new Error('Should not fetch');
  });
  for (const search of [{ page: 0 }, { pageSize: 101 }, { cursor: '*' }])
    await assert.rejects(
      provider.searchProducts(search),
      code('INVALID_SEARCH'),
    );
});

test('MOCK WooCommerce: 429 honors Retry-After without retry loops', async () => {
  let calls = 0;
  const provider = client(async () => {
    calls++;
    return new Response('sensitive-test-content', {
      status: 429,
      headers: { 'Retry-After': '30' },
    });
  });
  await assert.rejects(provider.searchProducts(), code('RATE_LIMIT'));
  await assert.rejects(provider.searchProducts(), code('RATE_LIMIT'));
  assert.equal(calls, 1);
});

test('MOCK WooCommerce: network, denied access and server errors are safe', async () => {
  await assert.rejects(
    client(async () => {
      throw new Error('sensitive-test-content');
    }).searchProducts(),
    code('NETWORK'),
  );
  await assert.rejects(
    client(
      async () => new Response('sensitive-test-content', { status: 403 }),
    ).searchProducts(),
    code('ACCESS_OR_QUOTA'),
  );
  await assert.rejects(
    client(
      async () => new Response('sensitive-test-content', { status: 500 }),
    ).searchProducts(),
    code('UPSTREAM'),
  );
});

test('MOCK WooCommerce: timeout aborts transport', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      client(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error('sensitive-test-content')),
              { once: true },
            );
          }),
        100,
      ).searchProducts(),
      code('TIMEOUT'),
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test('MOCK WooCommerce: local mode refuses external stores and configuration is independent', () => {
  assert.throws(
    () =>
      new WooCommerceProvider({
        ...config,
        baseUrl: 'https://external.example',
      }),
    code('CONFIGURATION'),
  );
  assert.throws(
    () =>
      new WooCommerceProvider({
        ...config,
        baseUrl: 'http://user:pass@localhost',
      }),
    code('CONFIGURATION'),
  );
  assert.throws(
    () => new WooCommerceProvider({ ...config, usage: 'authorized' }),
    code('CONFIGURATION'),
  );
  assert.throws(() => parseWooCommerceEnvironment({}), code('CONFIGURATION'));
  assert.equal(
    parseWooCommerceEnvironment({
      WOOCOMMERCE_BASE_URL: config.baseUrl,
      WOOCOMMERCE_STORE_NAME: config.storeName,
      WOOCOMMERCE_USAGE: 'local-test',
    }).timeoutMs,
    10000,
  );
});

test('LOCAL HTTP FIXTURE: provider works over a real loopback HTTP connection (not an actual WooCommerce store)', async () => {
  const server = createServer((request, response) => {
    assert.equal(
      request.url,
      '/wp-json/wc/store/v1/products?page=1&per_page=20',
    );
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    response.end(JSON.stringify([product]));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const provider = new WooCommerceProvider({
      ...config,
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    assert.equal(
      (await provider.searchProducts()).products[0]?.currentPrice,
      99.99,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('LOCAL HTTP FIXTURE: sample CLI labels synthetic local data and reports the actual received count', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    response.end(JSON.stringify([product]));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/scripts/woocommerce-sample.ts', '--limit', '1'],
      {
        env: {
          ...process.env,
          WOOCOMMERCE_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          WOOCOMMERCE_STORE_NAME: 'LOCAL TEST Fixture',
          WOOCOMMERCE_USAGE: 'local-test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    const timeout = setTimeout(() => child.kill(), 10000);
    try {
      const [exitCode] = await once(child, 'exit');
      assert.equal(exitCode, 0);
      assert.match(output, /LOCAL TEST WooCommerce HTTP response/);
      assert.match(output, /not commercial offers/);
      assert.match(output, /"fetchedProducts":1/);
      assert.match(output, /99\.99/);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
