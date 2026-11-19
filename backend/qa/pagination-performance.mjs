import 'dotenv/config';
import fs from 'node:fs';
import { createDatabaseClient } from '../dist/database/client.js';
import { CatalogService } from '../dist/services/catalog.js';
import { parseCatalogQuery } from '../dist/services/catalog-query.js';
import { encodeCatalogCursor } from '../dist/services/catalog-cursor.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/dealfinder_qa_test';
assertTestDatabase(url.href, process.env.DATABASE_URL);
const db = createDatabaseClient(url.href),
  service = new CatalogService(db, true);
const report = {
  checkedAt: new Date().toISOString(),
  samplesPerCase: 5,
  cases: [],
};
try {
  const size = await db.offer.count();
  if (size !== 100000) throw Error('Requires the completed 100k QA fixture');
  // Setup only: locate the preceding page boundary. Its OFFSET cost is NOT counted
  // as cursor traversal; a normal client receives this boundary from its last page.
  const [last] =
    await db.$queryRaw`SELECT id,last_updated_at FROM offers WHERE currency='USD' ORDER BY last_updated_at DESC,id ASC OFFSET 99979 LIMIT 1`;
  const base = parseCatalogQuery({
    sort: 'newest',
    currency: 'USD',
    pageSize: '20',
  });
  const cursorQuery = parseCatalogQuery({
    sort: 'newest',
    currency: 'USD',
    pageSize: '20',
    pagination: 'cursor',
  });
  const token = encodeCatalogCursor(cursorQuery, new Date(), last);
  let expected;
  for (const [name, query] of [
    ['offset-first', base],
    ['offset-deep', { ...base, page: 5000 }],
    ['cursor-deep', { ...cursorQuery, cursor: token }],
  ]) {
    const times = [];
    let result;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      result = await service.deals(query);
      times.push(performance.now() - start);
    }
    if (name === 'offset-deep') expected = result.data.map((v) => v.id);
    if (
      name === 'cursor-deep' &&
      JSON.stringify(expected) !== JSON.stringify(result.data.map((v) => v.id))
    )
      throw Error('Cursor/offset result mismatch');
    const sorted = [...times].sort((a, b) => a - b);
    report.cases.push({
      name,
      milliseconds: times,
      medianMs: sorted[2],
      p95Ms: sorted[4],
      items: result.data.length,
      total: result.pagination.total,
    });
  }
  report.sameDeepPage = true;
  console.log(JSON.stringify(report));
  fs.writeFileSync(
    '../docs/qa-evidence/pagination-optimization.json',
    JSON.stringify(report, null, 2),
  );
} finally {
  await db.$disconnect();
}
