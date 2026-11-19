import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import { once } from 'node:events';
import autocannon from 'autocannon';
import { createDatabaseClient } from '../dist/database/client.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
import { CatalogService } from '../dist/services/catalog.js';
import {
  dealScoreSql,
  defaultScoringRules,
} from '../dist/scoring/deal-scoring.js';
import { createApp } from '../dist/app.js';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/dealfinder_qa_test';
assertTestDatabase(url.href, process.env.DATABASE_URL);
const report = {
  checkedAt: new Date().toISOString(),
  purpose:
    'diagnose transaction acquisition errors, NOT a production capacity claim',
  cases: [],
};
for (const wait of [2000, 5000]) {
  if (os.freemem() < 1024 ** 3) {
    report.stopped = 'LOW_HOST_RAM';
    break;
  }
  const db = createDatabaseClient(url.href),
    service = new CatalogService(
      db,
      true,
      defaultScoringRules,
      dealScoreSql,
      wait,
    ),
    errorsByCode = {};
  let active = 0;
  for (const method of ['deals', 'products', 'product']) {
    const original = service[method].bind(service);
    service[method] = async (...args) => {
      active++;
      try {
        return await original(...args);
      } catch (e) {
        const code = typeof e?.code === 'string' ? e.code : 'UNKNOWN';
        errorsByCode[code] = (errorsByCode[code] ?? 0) + 1;
        throw e;
      } finally {
        active--;
      }
    };
  }
  const server = createApp(
    { CORS_ORIGINS: [], API_RATE_LIMIT_MAX: 1000000 },
    service,
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const paths = [
    '/deals?view=top&sort=score_desc',
    '/deals?sort=newest',
    '/deals?q=headphones&sort=newest',
    '/deals?categoryId=bbbbbbbb-bbbb-4bbb-8bbb-000000000001&sort=newest',
    '/deals?minPrice=10&maxPrice=30&sort=price_asc',
    '/deals?merchantId=aaaaaaaa-aaaa-4aaa-8aaa-000000000001&sort=newest',
    '/deals?page=20&sort=discount_desc',
    '/products/00000000-0000-4000-8000-000000000001',
  ];
  const latencies = [];
  let bad = 0,
    total = 0;
  const statuses = {};
  try {
    const result = await new Promise((resolve, reject) => {
      const runner = autocannon(
        {
          url: `http://127.0.0.1:${server.address().port}`,
          connections: 50,
          duration: 8,
          pipelining: 1,
          timeout: 15,
          requests: paths.map((p) => ({
            path:
              '/api/v1' + p + (p.includes('?') ? '&' : '?') + 'currency=USD',
          })),
        },
        (e, r) => (e ? reject(e) : resolve(r)),
      );
      runner.on('response', (_c, status, _bytes, time) => {
        total++;
        statuses[status] = (statuses[status] ?? 0) + 1;
        if (status >= 200 && status < 300) latencies.push(time);
        else bad++;
      });
      runner.on('tick', () => {
        if (os.freemem() < 1024 ** 3) runner.stop();
      });
    });
    latencies.sort((a, b) => a - b);
    report.cases.push({
      transactionMaxWaitMs: wait,
      durationSeconds: result.duration,
      successfulRps: (total - bad) / result.duration,
      errorRate: (bad + result.errors) / Math.max(1, total + result.errors),
      successfulP95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
      statuses,
      errorsByCode,
    });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    const deadline = Date.now() + 15000;
    while (active && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 25));
    await db.$disconnect();
  }
}
fs.writeFileSync(
  '../docs/qa-evidence/concurrency-optimization.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
