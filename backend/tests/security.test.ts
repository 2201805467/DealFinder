import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import {
  publicAddress,
  checkedAddresses,
  assertStoreUrl,
  boundedProviderJson,
  safeStoreFetch,
} from '../src/providers/safe-http.js';
import { WooCommerceProvider } from '../src/providers/woocommerce/woocommerce-provider.js';
import { parseCatalogQuery } from '../src/services/catalog-query.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { parseEnvironment } from '../src/config/env.js';

test('security headers, exact CORS, rate limit and forwarded-IP spoofing', async () => {
  const server = createApp({
    CORS_ORIGINS: ['https://allowed.example'],
    NODE_ENV: 'production',
    API_RATE_LIMIT_MAX: 2,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/health`;
    const first = await fetch(url, {
      headers: { Origin: 'https://allowed.example' },
    });
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(first.headers.get('content-security-policy'));
    assert.ok(first.headers.get('strict-transport-security'));
    assert.equal(
      first.headers.get('access-control-allow-origin'),
      'https://allowed.example',
    );
    const second = await fetch(url, {
      headers: { Origin: 'https://attacker.example' },
    });
    assert.equal(second.headers.get('access-control-allow-origin'), null);
    const limited = await fetch(url, {
      headers: { 'X-Forwarded-For': '8.8.8.8' },
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('oversized JSON returns bounded JSON 413, not a stack trace', async () => {
  const server = createApp({ CORS_ORIGINS: [] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const r = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/health`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'x'.repeat(110000) }),
      },
    );
    assert.equal(r.status, 413);
    assert.equal(
      ((await r.json()) as { error: { code: string } }).error.code,
      'PAYLOAD_TOO_LARGE',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('raw database/API failures never leak URL credentials in production errors', () => {
  let output: unknown;
  const res = {
    headersSent: false,
    status() {
      return this;
    },
    json(value: unknown) {
      output = value;
    },
  };
  errorHandler(
    new Error('postgres://admin:secret@database/apiKey=secret'),
    { method: 'GET' } as never,
    res as never,
    () => {},
  );
  assert.deepEqual(output, {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
});
test('invalid/structured queries, unbounded pages and raw filter operators are rejected', () => {
  for (const query of [
    { q: { $ne: '' } },
    { q: ['a', 'b'] },
    { pageSize: 100000 },
    { sort: 'name;DROP TABLE offers' },
    { page: -1 },
    { currency: 'USD OR 1=1' },
  ])
    assert.throws(() => parseCatalogQuery(query));
  assert.equal(parseCatalogQuery({ q: "' OR 1=1 --" }).q, "' OR 1=1 --"); // literal search, never raw SQL
});
test('SSRF rejects private, metadata, CGNAT, mapped, documentation and non-HTTP targets', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of [
    'https://127.1',
    'https://2130706433',
    'https://10.0.0.1',
    'https://[::1]',
    'https://metadata.google.internal',
    'http://store.example',
    'file:///etc/passwd',
    'https://user:pass@store.example',
  ])
    assert.throws(() => assertStoreUrl(new URL(url)));
});
test('all DNS answers must pass, with explicit loopback-only local-test permission', async () => {
  await assert.rejects(
    checkedAddresses('store.example', false, async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
  );
  assert.equal(
    (
      await checkedAddresses('localhost', true, async () => [
        { address: '127.0.0.1', family: 4 },
      ])
    ).length,
    1,
  );
  await assert.rejects(
    checkedAddresses('localhost', true, async () => [
      { address: '8.8.8.8', family: 4 },
    ]),
  );
});
test('upstream JSON is size bounded and malformed bodies fail safely', async () => {
  await assert.rejects(
    boundedProviderJson(
      new Response('x'.repeat(100)),
      new AbortController().signal,
      10,
    ),
  );
  await assert.rejects(
    boundedProviderJson(new Response('{broken'), new AbortController().signal),
  );
});
test('real local HTTP transport forbids redirects to internal metadata and handles 204', async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === '/empty') {
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(302, {
        Location: 'http://169.254.169.254/latest/meta-data/',
      });
      res.end();
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await assert.rejects(safeStoreFetch(true)(url));
    await assert.rejects(safeStoreFetch(true)(url + '/empty'));
    assert.equal(hits, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('commercial WooCommerce configuration rejects literal private HTTPS addresses', () => {
  assert.throws(
    () =>
      new WooCommerceProvider({
        baseUrl: 'https://192.168.0.1',
        storeName: 'unapproved',
        usage: 'authorized',
      }),
  );
});
test('remote production PostgreSQL requires verified TLS; loopback QA remains explicit', () => {
  assert.throws(() =>
    parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@database.example/deals',
    }),
  );
  assert.equal(
    parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://user:password@database.example/deals?sslmode=verify-full',
    }).NODE_ENV,
    'production',
  );
  assert.equal(
    parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/dealfinder_qa_test',
    }).NODE_ENV,
    'production',
  );
});
