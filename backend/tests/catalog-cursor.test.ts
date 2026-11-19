import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatalogQuery } from '../src/services/catalog-query.js';
import {
  encodeCatalogCursor,
  decodeCatalogCursor,
} from '../src/services/catalog-cursor.js';
test('cursor binds filters, size, lifetime and stable timestamp/UUID and rejects malformed data', () => {
  const q = parseCatalogQuery({ pagination: 'cursor', currency: 'USD' }),
    now = new Date('2026-11-19T09:00:00Z');
  const token = encodeCatalogCursor(q, now, {
    id: '00000000-0000-4000-8000-000000000001',
    last_updated_at: new Date(now.getTime() - 1),
  });
  assert.equal(
    decodeCatalogCursor(token, q, now)!.id,
    '00000000-0000-4000-8000-000000000001',
  );
  assert.throws(() =>
    decodeCatalogCursor(token, q, new Date(now.getTime() + 900001)),
  );
  assert.throws(() =>
    decodeCatalogCursor(token, q, new Date(now.getTime() - 1)),
  );
  assert.throws(() => decodeCatalogCursor(token, { ...q, pageSize: 21 }, now));
  for (const value of [
    '=invalid',
    'x'.repeat(2049),
    Buffer.from('{}').toString('base64url'),
  ])
    assert.throws(() => decodeCatalogCursor(value, q, now));
});
