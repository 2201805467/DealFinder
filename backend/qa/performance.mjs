// Local-only reproducible QA. NEVER targets a configured external HTTP endpoint.
import 'dotenv/config';
import { once } from 'node:events';
import { fork, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import autocannon from 'autocannon';
import { createDatabaseClient } from '../dist/database/client.js';
import { createApp } from '../dist/app.js';
import { CatalogService } from '../dist/services/catalog.js';
import {
  dealScoreSql,
  legacyDealScoreSql,
  defaultScoringRules,
} from '../dist/scoring/deal-scoring.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';

const label =
  process.argv.find((v) => v.startsWith('--label='))?.split('=')[1] ??
  'baseline';
if (!/^[a-z-]+$/.test(label)) throw Error('Invalid report label');
const development = process.env.DATABASE_URL;
const qaUrl = new URL(development);
qaUrl.pathname = '/dealfinder_qa_test';
assertTestDatabase(qaUrl.href, development);
const output = '../docs/qa-evidence';
const legacy = process.argv.includes('--legacy-score');
const scorer = legacy ? legacyDealScoreSql : dealScoreSql;
const argument = (name, fallback) =>
  Number(
    process.argv.find((v) => v.startsWith(`--${name}=`))?.split('=')[1] ??
      fallback,
  );
const mixedDuration = argument('duration', 5),
  singleDuration = argument('single-duration', 2);
const maxConnections = argument('max-connections', 1000),
  maxErrors = argument('max-error-rate', 0.02);
const heap = argument('api-heap-mb', 0);
if (![0, 128, 256].includes(heap)) throw Error('Invalid QA heap limit');
if (
  ![mixedDuration, singleDuration].every(
    (v) => Number.isInteger(v) && v >= 2 && v <= 60,
  ) ||
  ![10, 50, 100, 250, 500, 1000].includes(maxConnections) ||
  !Number.isFinite(maxErrors) ||
  maxErrors < 0 ||
  maxErrors > 0.02
)
  throw Error('Invalid bounded QA settings');
mkdirSync(output, { recursive: true });
if (process.argv.includes('--server')) {
  const db = createDatabaseClient(qaUrl.href);
  const server = createApp(
    { CORS_ORIGINS: [], API_RATE_LIMIT_MAX: 1000000 },
    new CatalogService(db, true, defaultScoringRules, scorer),
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  if (process.send) process.send({ port: server.address().port });
  else console.log(JSON.stringify({ port: server.address().port }));
  let previous = process.cpuUsage(),
    time = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const used = process.cpuUsage(previous);
    previous = process.cpuUsage();
    process.send?.({
      cpu: ((used.user + used.system) / 1000 / (now - time)) * 100,
      rss: process.memoryUsage().rss,
    });
    time = now;
  }, 500);
  process.on('message', async (m) => {
    if (m === 'stop') {
      clearInterval(timer);
      server.closeAllConnections();
      server.close();
      await db.$disconnect();
      process.exit(0);
    }
  });
} else {
  const admin = createDatabaseClient(development);
  try {
    const found =
      await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname='dealfinder_qa_test'`;
    if (!found.length)
      await admin.$executeRawUnsafe('CREATE DATABASE dealfinder_qa_test');
  } finally {
    await admin.$disconnect();
  }
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      env: {
        ...process.env,
        DATABASE_URL: qaUrl.href,
        MIGRATION_DATABASE_URL: qaUrl.href,
      },
      stdio: 'inherit',
    },
  );
  if (migrated.status !== 0) throw Error('QA migrations failed');
  const db = createDatabaseClient(qaUrl.href);
  const report = {
    label,
    startedAt: new Date().toISOString(),
    tool: 'autocannon',
    durationSeconds: mixedDuration,
    singleDurationSeconds: singleDuration,
    scoringMode: legacy ? 'legacy-reference' : 'generated-factors',
    apiHeapLimitMB: heap || null,
    environment: {
      node: process.version,
      cpus: os.cpus().length,
      ramBytes: os.totalmem(),
    },
    guardrails: {
      minimumFreeRAMBytes: 1024 ** 3,
      stopOnErrorRate: maxErrors,
      stopOnP95ms: 2000,
      maximumConcurrency: maxConnections,
    },
    datasets: [],
  };
  const save = () =>
    writeFileSync(
      `${output}/performance-${label}.json`,
      JSON.stringify(report, null, 2),
    );
  const exec = promisify(execFile);
  let child;
  try {
    const sizesArgument = process.argv
      .find((v) => v.startsWith('--sizes='))
      ?.split('=')[1];
    const sizes = sizesArgument
      ? sizesArgument.split(',').map(Number)
      : [1000, 10000, 50000, 100000];
    if (sizes.some((v) => ![1000, 10000, 50000, 100000].includes(v)))
      throw Error('Unsupported fixture size');
    for (const size of sizes) {
      if (os.freemem() < 1024 ** 3) {
        report.stopped = 'LOW_HOST_RAM';
        break;
      }
      const identity = await db.$queryRaw`SELECT current_database() AS name`;
      if (identity[0].name !== 'dealfinder_qa_test')
        throw Error('Refusing non-QA reset');
      await db.$transaction(
        async (tx) => {
          // Bulk QA setup is separate from bounded public API statements.
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
          await tx.$executeRawUnsafe(
            'TRUNCATE sync_runs,offers,products,categories,merchants CASCADE',
          );
          await tx.$executeRaw`INSERT INTO merchants(id,name,source_type,website_url,enabled,storage_authorized,is_synthetic,retention_seconds)
          SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid,'SYNTHETIC QA Merchant '||i,'SYNTHETIC',
          'https://qa-'||i||'.example.invalid',true,true,true,86400 FROM generate_series(1,5) i`;
          await tx.$executeRaw`INSERT INTO categories(id,name,slug,is_synthetic)
          SELECT ('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(i::text,12,'0'))::uuid,'SYNTHETIC QA Category '||i,'qa-'||i,true FROM generate_series(1,10) i`;
          await tx.$executeRaw`INSERT INTO products(id,name,description,category_id,content_merchant_id,content_external_id,is_synthetic,expires_at,updated_at)
          SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          'SYNTHETIC QA '||CASE WHEN i%10=0 THEN 'headphones ' ELSE 'product ' END||i,'Synthetic load fixture, not commercial inventory.',
          ('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad((i%10+1)::text,12,'0'))::uuid,
          ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad((i%5+1)::text,12,'0'))::uuid,i::text,true,now()+interval '1 day',now()
          FROM generate_series(1,${size}::int) i`;
          await tx.$executeRaw`INSERT INTO offers(id,product_id,merchant_id,external_product_id,current_price,reference_price,discount_percentage,
          currency,market,availability,is_synthetic,reference_price_trusted,product_url,last_updated_at,stale_at,expires_at)
          SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad((i%5+1)::text,12,'0'))::uuid,i::text,
          (i%10000)/100.0+1.99,((i%10000)/100.0+1.99)*2,50,'USD','US','AVAILABLE',true,true,
          'https://qa.example.invalid/product/'||i,now(),now()+interval '6 hours',now()+interval '1 day'
          FROM generate_series(1,${size}::int) i`;
        },
        { timeout: 120000 },
      );
      await db.$executeRawUnsafe('ANALYZE products');
      await db.$executeRawUnsafe('ANALYZE offers');
      child = fork(
        new URL(import.meta.url),
        ['--server', ...(legacy ? ['--legacy-score'] : [])],
        {
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          ...(heap ? { execArgv: ['--max-old-space-size=' + heap] } : {}),
        },
      );
      const { port } = await new Promise((resolve, reject) => {
        child.on('message', (m) => {
          if (m.port) resolve(m);
        });
        child.once('error', reject);
      });
      const base = `http://127.0.0.1:${port}`;
      const sanity = await (
        await fetch(base + '/api/v1/deals?currency=USD&pageSize=1')
      ).json();
      if (sanity.pagination?.total !== size)
        throw Error('Fixture/API mismatch');
      const dataset = { products: size, plans: {}, cases: [] };
      report.datasets.push(dataset);
      const now = new Date();
      const score = scorer(now);
      const clauses = new CatalogService(db, true).sqlFilters(
        { currency: 'USD' },
        now,
      );
      const from = Prisma.sql`FROM offers o JOIN products p ON p.id=o.product_id JOIN merchants m ON m.id=o.merchant_id JOIN merchants cm ON cm.id=p.content_merchant_id WHERE ${Prisma.join(clauses, ' AND ')} AND o.stale_at>${now} AND o.reference_price_trusted AND o.discount_percentage>0`;
      for (const [name, order] of [
        ['score', Prisma.sql`${score} DESC`],
        ['newest', Prisma.sql`o.last_updated_at DESC`],
      ]) {
        dataset.plans[name] = await db.$queryRaw(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT o.id ${from} ORDER BY ${order},o.id LIMIT 20`,
        );
      }
      const endpoints = [
        ['top', '/deals?view=top&sort=score_desc'],
        ['latest', '/deals?sort=newest'],
        ['search', '/deals?q=headphones&sort=newest'],
        [
          'category',
          '/deals?categoryId=bbbbbbbb-bbbb-4bbb-8bbb-000000000001&sort=newest',
        ],
        ['price', '/deals?minPrice=10&maxPrice=30&sort=price_asc'],
        [
          'merchant',
          '/deals?merchantId=aaaaaaaa-aaaa-4aaa-8aaa-000000000001&sort=newest',
        ],
        ['pagination', '/deals?page=20&sort=discount_desc'],
        ['detail', '/products/00000000-0000-4000-8000-000000000001'],
      ];
      const paths = endpoints.map(([name, path]) => ({
        name,
        path:
          '/api/v1' + path + (path.includes('?') ? '&' : '?') + 'currency=USD',
      }));
      const scenarios = [
        ...paths.map((p) => ({
          name: p.name,
          requests: [{ path: p.path }],
          connections: 10,
          duration: singleDuration,
        })),
        ...[10, 50, 100, 250, 500, 1000]
          .filter((v) => v <= maxConnections)
          .map((connections) => ({
            name: 'mixed',
            requests: paths.map((p) => ({ path: p.path })),
            connections,
            duration: mixedDuration,
          })),
      ];
      let noMoreMixed = false;
      for (const scenario of scenarios) {
        if (os.freemem() < 1024 ** 3) {
          report.stopped = 'LOW_HOST_RAM';
          break;
        }
        if (noMoreMixed && scenario.name === 'mixed') continue;
        const samples = [],
          latencies = [],
          successfulLatencies = [];
        const statuses = {};
        let bad = 0,
          total = 0,
          polling = false;
        const consume = (m) => {
          if (m.cpu !== undefined) samples.push(m);
        };
        child.on('message', consume);
        const monitor = setInterval(async () => {
          if (polling) return;
          polling = true;
          try {
            const rows =
              await db.$queryRaw`SELECT count(*)::int AS total,count(*) FILTER(WHERE state='active')::int AS active FROM pg_stat_activity WHERE datname=current_database()`;
            samples.push({
              connections: rows[0].total,
              active: rows[0].active,
              freeRAM: os.freemem(),
            });
          } catch {
          } finally {
            polling = false;
          }
        }, 500);
        let result;
        try {
          result = await new Promise((resolve, reject) => {
            const runner = autocannon(
              {
                url: base,
                connections: scenario.connections,
                duration: scenario.duration,
                pipelining: 1,
                timeout: 10,
                requests: scenario.requests,
              },
              (e, r) => (e ? reject(e) : resolve(r)),
            );
            runner.on('response', (_client, status, _bytes, time) => {
              total++;
              latencies.push(time);
              statuses[status] = (statuses[status] ?? 0) + 1;
              if (status >= 200 && status < 300) successfulLatencies.push(time);
              if (status < 200 || status >= 300) bad++;
            });
            runner.on('tick', () => {
              if (os.freemem() < 1024 ** 3) runner.stop();
            });
          });
        } finally {
          clearInterval(monitor);
          child.off('message', consume);
        }
        latencies.sort((a, b) => a - b);
        successfulLatencies.sort((a, b) => a - b);
        const percentile = (p) =>
          latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? null;
        const row = {
          name: scenario.name,
          connections: scenario.connections,
          durationSeconds: result.duration,
          requests: total,
          rps: total / result.duration,
          successfulRps: (total - bad) / result.duration,
          successfulP95Ms:
            successfulLatencies[
              Math.max(0, Math.ceil(successfulLatencies.length * 0.95) - 1)
            ] ?? null,
          successfulP99Ms:
            successfulLatencies[
              Math.max(0, Math.ceil(successfulLatencies.length * 0.99) - 1)
            ] ?? null,
          statuses,
          averageMs: latencies.length
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : null,
          medianMs: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
          errorRate: (bad + result.errors) / Math.max(1, total + result.errors),
          non2xx: bad,
          transportErrors: result.errors,
          apiPeakCPUPercent: Math.max(0, ...samples.map((s) => s.cpu ?? 0)),
          apiPeakRAMBytes: Math.max(0, ...samples.map((s) => s.rss ?? 0)),
          dbPeakConnections: Math.max(
            0,
            ...samples.map((s) => s.connections ?? 0),
          ),
          dbPeakActive: Math.max(0, ...samples.map((s) => s.active ?? 0)),
          minimumFreeRAMBytes: Math.min(
            os.freemem(),
            ...samples.map((s) => s.freeRAM ?? Infinity),
          ),
        };
        try {
          const { stdout } = await exec(
            'docker',
            [
              'stats',
              '--no-stream',
              '--format',
              '{{json .}}',
              'dealfinder-postgres-1',
            ],
            { timeout: 5000 },
          );
          row.databaseContainer = JSON.parse(stdout.trim());
        } catch {
          row.databaseContainer = null;
        }
        dataset.cases.push(row);
        console.log(JSON.stringify({ label, size, ...row }));
        save();
        if (row.minimumFreeRAMBytes < 1024 ** 3) {
          report.stopped = 'LOW_HOST_RAM';
          break;
        }
        if (
          scenario.name === 'mixed' &&
          (row.errorRate > maxErrors ||
            row.p95Ms > 2000 ||
            row.minimumFreeRAMBytes < 1024 ** 3)
        ) {
          noMoreMixed = true;
          dataset.stoppedEscalationAt = scenario.connections;
          dataset.stopReason = 'Latency/error/resource guardrail';
        }
      }
      child.send('stop');
      await once(child, 'exit');
      child = undefined;
      save();
      if (report.stopped) break;
    }
    report.finishedAt = new Date().toISOString();
    save();
  } finally {
    if (child) {
      child.kill();
    }
    await db.$disconnect();
  }
}
