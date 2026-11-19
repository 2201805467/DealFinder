import 'dotenv/config';
import fs from 'node:fs';
import { createDatabaseClient } from '../dist/database/client.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
import {
  legacyDealScoreSql as dealScoreSql,
  dealScoreSql as optimizedScore,
} from '../dist/scoring/deal-scoring.js';
import { Prisma } from '../dist/generated/prisma/client.js';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/dealfinder_qa_test';
assertTestDatabase(url.href, process.env.DATABASE_URL);
const db = createDatabaseClient(url.href),
  now = new Date();
try {
  const filters = [
    Prisma.sql`(o.expires_at IS NULL OR o.expires_at>${now})`,
    Prisma.sql`(p.expires_at IS NULL OR p.expires_at>${now})`,
    Prisma.sql`m.enabled AND m.storage_authorized AND cm.enabled AND cm.storage_authorized`,
    Prisma.sql`o.currency='USD'`,
  ];
  filters.push(
    Prisma.sql`o.stale_at>${now} AND o.current_price IS NOT NULL AND o.availability='AVAILABLE' AND o.reference_price_trusted AND o.discount_percentage>0 AND o.reference_price>o.current_price`,
  );
  const from = Prisma.sql`FROM offers o JOIN products p ON p.id=o.product_id JOIN merchants m ON m.id=o.merchant_id JOIN merchants cm ON cm.id=p.content_merchant_id WHERE ${Prisma.join(filters, ' AND ')}`;
  const score = dealScoreSql(now);
  const authorized = Prisma.sql`ARRAY(SELECT id FROM merchants WHERE enabled AND storage_authorized)`;
  const arrayFrom = Prisma.sql`FROM offers o JOIN products p ON p.id=o.product_id WHERE
    (o.expires_at IS NULL OR o.expires_at>${now}) AND(p.expires_at IS NULL OR p.expires_at>${now})
    AND o.merchant_id=ANY(${authorized}) AND p.content_merchant_id=ANY(${authorized})
    AND o.currency='USD' AND o.stale_at>${now} AND o.current_price IS NOT NULL
    AND o.availability='AVAILABLE' AND o.reference_price_trusted AND o.discount_percentage>0 AND o.reference_price>o.current_price`;
  const plans = { checkedAt: now.toISOString(), cases: [] };
  for (const [name, sql] of [
    [
      'materialized',
      Prisma.sql`WITH scored AS MATERIALIZED(SELECT o.id,${score} AS score ${from}) SELECT id,count(*) OVER() AS total FROM scored WHERE score>=65 ORDER BY score DESC,id LIMIT 20`,
    ],
    [
      'inline',
      Prisma.sql`SELECT o.id,count(*) OVER() AS total ${from} AND ${score}>=65 ORDER BY ${score} DESC,o.id LIMIT 20`,
    ],
    [
      'no-score',
      Prisma.sql`SELECT o.id,count(*) OVER() AS total ${from} ORDER BY o.last_updated_at DESC,o.id LIMIT 20`,
    ],
    ['count-joins', Prisma.sql`SELECT count(*) ${from}`],
    ['count-policy-array', Prisma.sql`SELECT count(*) ${arrayFrom}`],
    [
      'score-policy-array',
      Prisma.sql`WITH scored AS MATERIALIZED(SELECT o.id,${optimizedScore(now, undefined, true)} AS score ${arrayFrom}) SELECT id,count(*) OVER() AS total FROM scored WHERE score>=65 ORDER BY score DESC,id LIMIT 20`,
    ],
  ]) {
    const rows = await db.$queryRaw(
      Prisma.sql`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,
    );
    const plan = rows[0]['QUERY PLAN'][0];
    plans.cases.push({ name, executionMs: plan['Execution Time'], plan });
    console.log(name, plan['Execution Time']);
  }
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='120s'");
        const existing =
          await tx.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_name='offers' AND column_name='score_discount_percent'`;
        if (!existing.length)
          await tx.$executeRawUnsafe(
            fs.readFileSync(
              'prisma/migrations/20261119090000_score_factors/migration.sql',
              'utf8',
            ),
          );
        const epoch = new Prisma.Decimal(now.getTime()).div(1000).toFixed(3);
        const factorScore = Prisma.sql`round(LEAST(o.score_discount_percent,50::numeric)/50::numeric*35
    + GREATEST(0::numeric,LEAST(1::numeric,1-GREATEST(0::numeric,${epoch}::numeric-o.score_updated_epoch)/o.score_freshness_seconds))*25
    + CASE WHEN o.availability='AVAILABLE' THEN 20 ELSE 0 END
    + ((CASE WHEN o.product_url IS NOT NULL THEN 1 ELSE 0 END)+(CASE WHEN p.image_url IS NOT NULL THEN 1 ELSE 0 END))::numeric/2*10
    + o.score_shipping_fraction*10,2)`;
        const sql = Prisma.sql`WITH scored AS MATERIALIZED(SELECT o.id,${factorScore} AS score ${from}) SELECT id,count(*) OVER() AS total FROM scored WHERE score>=65 ORDER BY score DESC,id LIMIT 20`;
        await tx.$executeRawUnsafe('ANALYZE merchants');
        await tx.$executeRawUnsafe('ANALYZE offers');
        for (const mb of [4, 8]) {
          await tx.$executeRawUnsafe(`SET LOCAL work_mem='${mb}MB'`);
          const rows = await tx.$queryRaw(
            Prisma.sql`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,
          );
          const plan = rows[0]['QUERY PLAN'][0];
          plans.cases.push({
            name: `generated-factors-${mb}mb`,
            executionMs: plan['Execution Time'],
            plan,
          });
          console.log(`generated-factors-${mb}mb`, plan['Execution Time']);
        }
        const errors = await tx.$queryRaw(
          Prisma.sql`SELECT count(*) AS differences ${from} AND ${score}<>${factorScore}`,
        );
        plans.numericDifferences = String(errors[0].differences);
        throw Object.assign(new Error('Rollback measured prototype'), {
          qaRollback: true,
        });
      },
      { timeout: 120000 },
    )
    .catch((e) => {
      if (!e.qaRollback) throw e;
    });
  fs.writeFileSync(
    '../docs/qa-evidence/optimization-probe.json',
    JSON.stringify(plans, null, 2),
  );
} finally {
  await db.$disconnect();
}
