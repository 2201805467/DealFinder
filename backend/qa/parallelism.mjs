import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { CatalogService } from '../dist/services/catalog.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/dealfinder_qa_test';
assertTestDatabase(url.href, process.env.DATABASE_URL);
const evidence = {
  checkedAt: new Date().toISOString(),
  requestsPerCase: 50,
  concurrency: 10,
  cases: [],
};
for (const parallelWorkers of [2, 0]) {
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.href,
      max: 10,
      statement_timeout: 5000,
      options: `-c max_parallel_workers_per_gather=${parallelWorkers}`,
    }),
  });
  const row = { parallelWorkers, ok: 0, failures: [], durations: [] };
  try {
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          try {
            await new CatalogService(db, true).deals({
              page: 1,
              pageSize: 20,
              currency: 'USD',
              view: 'top',
              sort: 'score_desc',
            });
            row.ok++;
          } catch (e) {
            const cause = e.meta?.driverAdapterError?.cause;
            row.failures.push({
              code: e.code,
              sqlState: cause?.code,
              message: cause?.message ?? 'Database request failed',
            });
          }
          row.durations.push(performance.now() - start);
        }
      }),
    );
  } finally {
    await db.$disconnect();
  }
  evidence.cases.push(row);
  console.log(
    JSON.stringify({
      parallelWorkers,
      ok: row.ok,
      failed: row.failures.length,
      example: row.failures[0],
    }),
  );
}
writeFileSync(
  '../docs/qa-evidence/parallelism.json',
  JSON.stringify(evidence, null, 2),
);
