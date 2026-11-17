import 'dotenv/config';
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { assertTestDatabase } from '../database/development-guard.js';

config({ path: '.env.test', quiet: true });
try {
  const url = assertTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.DATABASE_URL,
  );
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    CATALOG_INTEGRATION: '1',
  };
  // Run local CLI entry points directly, with no shell interpolation or resets.
  for (const args of [
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    ['--import', 'tsx', '--test', 'tests/integration/catalog.test.ts'],
  ]) {
    const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} catch {
  console.error(
    'Integration setup requires a separate local TEST_DATABASE_URL ending in _test.',
  );
  process.exitCode = 1;
}
