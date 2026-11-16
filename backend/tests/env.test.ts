import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../src/config/env.js';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' };

test('environment parsing supplies defaults and splits CORS origins', () => {
  const config = parseEnvironment({
    ...base,
    CORS_ORIGINS: 'http://localhost:5173, https://example.com',
  });
  assert.equal(config.PORT, 3000);
  assert.deepEqual(config.CORS_ORIGINS, [
    'http://localhost:5173',
    'https://example.com',
  ]);
  assert.deepEqual(parseEnvironment(base).CORS_ORIGINS, []);
});

test('invalid environment fails without disclosing credentials', () => {
  for (const input of [
    {},
    { ...base, PORT: '70000' },
    { ...base, DATABASE_URL: 'not-a-url-secret' },
    { ...base, DATABASE_URL: 'https://user:secret@example.com' },
    { ...base, CORS_ORIGINS: '*' },
    { ...base, CORS_ORIGINS: 'https://example.com/path' },
  ]) {
    assert.throws(
      () => parseEnvironment(input),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid environment variables/);
        assert.ok(!error.message.includes('secret'));
        return true;
      },
    );
  }
});
