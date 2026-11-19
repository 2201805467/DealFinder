/** Explicit opt-in acceptance run, never part of npm test. Bounded real HTTP, no raw feed archive. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createDatabaseClient } from '../src/database/client.js';
import { prepareRealSource } from '../src/services/real-sources.js';
import { realRegistry } from '../src/services/provider-registry.js';
import { ProductSynchronizationService } from '../src/services/product-synchronization.js';
import { parseWorkerEnvironment } from '../src/config/worker.js';
import { CatalogService } from '../src/services/catalog.js';
import { parseCatalogQuery } from '../src/services/catalog-query.js';
import { createApp } from '../src/app.js';

if (!process.argv.includes('--confirm'))
  throw new Error(
    'Explicit --confirm required for real source requests and local writes.',
  );
const db = createDatabaseClient(process.env.DATABASE_URL ?? '');
const options = parseWorkerEnvironment({
  ...process.env,
  WORKER_ENABLED: 'true',
  WORKER_ALLOW_SYNTHETIC: 'false',
  CHEAPSHARK_ENABLED: 'true',
  GAMERPOWER_ENABLED: 'true',
  WORKER_MAX_PRODUCTS: '20',
  WORKER_MAX_PAGES: '1',
  WORKER_MAX_REQUESTS: '6',
  WORKER_PAGE_SIZE: '20',
});
const sync = new ProductSynchronizationService(
  db,
  realRegistry(),
  options,
  'development',
);
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  existingDataOnly: process.argv.includes('--verify-existing'),
  note: 'REAL DATA, bounded sample, not catalogue coverage or price history. Operational TTL applies to the live database; this is a one-time acceptance report.',
};
let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
try {
  for (const key of ['cheapshark', 'gamerpower'] as const) {
    const source = await prepareRealSource(db, key);
    const filter = { merchant: { dataSourceId: source.id } };
    const before = await db.offer.count({ where: filter });
    if (process.argv.includes('--verify-existing')) {
      const syncRuns = await db.syncRun.findMany({
        where: { merchantId: source.id, scope: 'SYNCHRONIZATION' },
        orderBy: { startedAt: 'desc' },
        take: 2,
        select: {
          id: true,
          startedAt: true,
          finishedAt: true,
          status: true,
          processedCount: true,
          requestCount: true,
          pageCount: true,
          skippedCount: true,
          errorCode: true,
        },
      });
      assert.equal(syncRuns.length, 2);
      assert.ok(
        syncRuns.every(
          (r) =>
            r.processedCount === 20 &&
            r.errorCode === 'PAGE_LIMIT' &&
            r.skippedCount === 0,
        ),
      );
      const duplicateGroups = await db.$queryRaw<
        { duplicates: bigint }[]
      >`SELECT count(*) AS duplicates FROM (SELECT o.merchant_id,o.external_product_id,o.market,o.variant_key,o.currency FROM offers o JOIN merchants m ON m.id=o.merchant_id WHERE m.data_source_id=${source.id}::uuid GROUP BY o.merchant_id,o.external_product_id,o.market,o.variant_key,o.currency HAVING count(*)>1) d`;
      assert.equal(Number(duplicateGroups[0]!.duplicates), 0);
      report[key] = {
        savedOffers: before,
        savedProducts: await db.product.count({
          where: { contentMerchantId: source.id },
        }),
        duplicateOffers: 0,
        syncRuns,
        note: 'Verified existing real data and last two persisted live sync runs; no new product-source API requests in this pass.',
      };
      console.log(JSON.stringify({ source: key, ...(report[key] as object) }));
      continue;
    }
    const first = await sync.runSource(source.id, undefined, true);
    assert.ok(
      first.processedCount > 0,
      `No real ${key} products ingested: ${first.errorCode}`,
    );
    const ids = (
      await db.offer.findMany({ where: filter, select: { id: true } })
    )
      .map((o) => o.id)
      .sort();
    const second = await sync.runSource(source.id, undefined, true);
    assert.equal(second.processedCount, first.processedCount);
    const afterIds = (
      await db.offer.findMany({ where: filter, select: { id: true } })
    )
      .map((o) => o.id)
      .sort();
    assert.deepEqual(
      afterIds,
      ids,
      'Re-sync changed stable identities or introduced duplicates.',
    );
    const products = await db.product.count({
      where: { contentMerchantId: source.id },
    });
    report[key] = {
      beforeOffers: before,
      first,
      savedOffers: ids.length,
      savedProducts: products,
      second,
      afterOffers: afterIds.length,
      duplicateOffers: 0,
    };
    console.log(JSON.stringify({ source: key, ...(report[key] as object) }));
  }
  const catalog = new CatalogService(db, false);
  server = createApp(
    { NODE_ENV: 'production', CORS_ORIGINS: [] },
    catalog,
  ).listen(process.argv.includes('--serve') ? 3337 : 0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const response = await fetch(
    base + '/deals?view=all&pageSize=100&currency=USD&sort=newest',
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: {
      id: string;
      isSynthetic: boolean;
      source: { key: string } | null;
    }[];
  };
  assert.ok(body.data.some((o) => o.source?.key === 'CHEAPSHARK'));
  assert.ok(body.data.some((o) => o.source?.key === 'GAMERPOWER'));
  assert.ok(body.data.every((o) => !o.isSynthetic));
  const all = await catalog.deals(
    parseCatalogQuery({ view: 'all', pageSize: 100 }),
  );
  report.rest = {
    status: response.status,
    visibleOffers: body.data.length,
    syntheticOffers: 0,
    examples: ['CHEAPSHARK', 'GAMERPOWER'].map((key) => {
      const o = all.data.find((o) => o.source?.key === key)!;
      return {
        id: o.id,
        name: o.product.name,
        retailer: o.merchant.name,
        source: o.source?.name,
        currentPrice: o.currentPrice,
        referencePrice: o.referencePrice,
        discountPercentage: o.discountPercentage,
        currency: o.currency,
        productUrl: o.productUrl,
        expiresAt: o.expiresAt,
      };
    }),
  };
  console.log(JSON.stringify(report.rest));
  // One HEAD per source: inspect official link response without following it to another retailer.
  report.links = [];
  for (const key of process.argv.includes('--verify-existing')
    ? []
    : ['CHEAPSHARK', 'GAMERPOWER']) {
    const offer = all.data.find((o) => o.source?.key === key)!;
    try {
      const r = await fetch(offer.productUrl!, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'DealFinder/0.1 PortfolioDemo' },
      });
      (report.links as unknown[]).push({
        source: key,
        status: r.status,
        redirected: r.status >= 300 && r.status < 400,
        destinationHost: r.headers.get('location')
          ? new URL(r.headers.get('location')!, offer.productUrl!).host
          : null,
        followedToRetailer: false,
      });
    } catch {
      (report.links as unknown[]).push({
        source: key,
        error: 'LINK_HTTP_CHECK_FAILED',
      });
    }
  }
  if (process.argv.includes('--verify-existing'))
    report.links = JSON.parse(
      readFileSync('../docs/qa-evidence/phase7-local-check.json', 'utf8'),
    );
  if (process.argv.includes('--flutter')) {
    const child = spawn(
      'C:/flutter/bin/cache/dart-sdk/bin/dart.exe',
      [
        'C:/flutter/bin/cache/flutter_tools.snapshot',
        'test',
        'tool/real_data_ui_test.dart',
        '--dart-define=API_BASE_URL=' + base,
        '--reporter',
        'expanded',
      ],
      { cwd: '../mobile', stdio: 'inherit' },
    );
    const [code] = await once(child, 'exit');
    report.flutterExitCode = code;
    assert.equal(code, 0);
  }
  writeFileSync(
    '../docs/qa-evidence/phase7-real-data.json',
    JSON.stringify(report, null, 2),
  );
  if (process.argv.includes('--serve')) {
    console.log(
      'Local acceptance API remains at ' +
        base +
        ' for emulator testing; Ctrl+C stops it.',
    );
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
      process.stdin.once('data', () => resolve());
    });
  }
} finally {
  writeFileSync(
    '../docs/qa-evidence/phase7-real-data.json',
    JSON.stringify(report, null, 2),
  );
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  await db.$disconnect();
}
