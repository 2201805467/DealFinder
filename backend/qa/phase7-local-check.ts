import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createDatabaseClient } from '../src/database/client.js';
if (!process.argv.includes('--confirm'))
  throw new Error('Explicit --confirm required for two official link checks.');
const db = createDatabaseClient(process.env.DATABASE_URL ?? '');
try {
  const report = {
    checkedAt: new Date().toISOString(),
    development: {
      syntheticProducts: await db.product.count({
        where: { isSynthetic: true },
      }),
      syntheticOffers: await db.offer.count({ where: { isSynthetic: true } }),
    },
    links: [] as object[],
  };
  for (const sourceType of ['CHEAPSHARK', 'GAMERPOWER'] as const) {
    const offer = await db.offer.findFirstOrThrow({
      where: { merchant: { sourceType, dataSourceId: { not: null } } },
      orderBy: { lastUpdatedAt: 'desc' },
    });
    const url = new URL(offer.productUrl!);
    if (
      url.origin !==
      (sourceType === 'CHEAPSHARK'
        ? 'https://www.cheapshark.com'
        : 'https://www.gamerpower.com')
    )
      throw new Error('Unexpected link origin.');
    try {
      const r = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'DealFinder/0.1 PortfolioDemo' },
      });
      await r.body?.cancel();
      report.links.push({
        sourceType,
        method: 'GET',
        status: r.status,
        destinationHost: r.headers.get('location')
          ? new URL(r.headers.get('location')!, url).host
          : null,
        followedToRetailer: false,
      });
    } catch {
      report.links.push({ sourceType, error: 'LINK_REQUEST_FAILED' });
    }
  }
  writeFileSync(
    '../docs/qa-evidence/phase7-local-check.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await db.$disconnect();
}
