import 'dotenv/config';
import fs from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createDatabaseClient } from '../dist/database/client.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/dealfinder_qa_test';
assertTestDatabase(url.href, process.env.DATABASE_URL);
const db = createDatabaseClient(url.href);
const report = { checkedAt: new Date().toISOString(), http: [], guards: [] };
const env = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: url.href,
  HOST: '127.0.0.1',
  PORT: '4017',
  WORKER_ENABLED: 'true',
  WORKER_ALLOW_SYNTHETIC: 'true',
};
const before = await db.offer.count();
const child = spawn(process.execPath, ['dist/server.js'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', (b) => {
        if (b.toString().includes('Backend listening')) resolve();
      });
      child.once('error', reject);
      child.once('exit', () => reject(Error('Production server exited')));
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error('Server startup timeout')), 15000).unref(),
    ),
  ]);
  for (const path of [
    '/deals',
    '/deals?view=top',
    '/deals?pagination=cursor&sort=newest',
    '/products',
    '/categories',
    '/merchants',
  ]) {
    const r = await fetch('http://127.0.0.1:4017/api/v1' + path);
    const j = await r.json();
    if (r.status !== 200 || j.data.length !== 0)
      throw Error('Synthetic production data exposed');
    report.http.push({
      path,
      status: r.status,
      items: j.data.length,
      nosniff: r.headers.get('x-content-type-options'),
    });
  }
  for (const script of ['worker', 'seed', 'seed-worker']) {
    const args = [
      `dist/scripts/${script}.js`,
      ...(script === 'worker' ? ['--once'] : []),
    ];
    const result = spawnSync(process.execPath, args, {
      env,
      encoding: 'utf8',
      timeout: 20000,
    });
    if (result.status !== 1)
      throw Error('Production guard did not reject ' + script);
    report.guards.push({ script, exitCode: result.status });
  }
  if ((await db.offer.count()) !== before)
    throw Error('Production guard mutated synthetic offers');
  report.syntheticOffersUnchanged = before;
  report.database =
    await db.$queryRaw`SELECT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS connection_tls, current_setting('max_parallel_workers_per_gather') AS parallel_workers`;
  const git = 'C:/Users/taham/AppData/Local/Programs/Git/cmd/git.exe';
  report.trackedSensitiveFiles = execFileSync(
    git,
    ['ls-files', '--', 'backend/.env', 'backend/.env.test', 'mobile/.env'],
    { cwd: '..', encoding: 'utf8' },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (report.trackedSensitiveFiles.length)
    throw Error('Sensitive env file tracked');
  report.developmentCounts = await (async () => {
    const dev = createDatabaseClient(process.env.DATABASE_URL);
    try {
      return {
        products: await dev.product.count(),
        offers: await dev.offer.count(),
      };
    } finally {
      await dev.$disconnect();
    }
  })();
  fs.writeFileSync(
    '../docs/qa-evidence/production-guards.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  child.kill();
  await once(child, 'exit').catch(() => {});
  await db.$disconnect();
}
