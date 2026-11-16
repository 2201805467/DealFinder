import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { createApp } from '../src/app.js';

const app = createApp({ CORS_ORIGINS: ['http://localhost:5173'] });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

test('health endpoint reports server liveness without a database', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'dealfinder-backend',
  });
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('unknown routes return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

test('CORS allows configured origins and excludes other origins', async () => {
  const allowed = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'http://localhost:5173',
  );
  const denied = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('malformed JSON is handled centrally', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
  });
});
