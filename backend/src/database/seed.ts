import type { PrismaClient } from '../generated/prisma/client.js';
import { OfferIngestionService } from '../services/offer-ingestion.js';

export async function seedDevelopment(db: PrismaClient) {
  const root = await db.category.upsert({
    where: { slug: 'demo-electronics' },
    create: {
      slug: 'demo-electronics',
      name: 'DEMO Electronics',
      isSynthetic: true,
    },
    update: {},
  });
  const child = await db.category.upsert({
    where: { slug: 'demo-audio' },
    create: {
      slug: 'demo-audio',
      name: 'DEMO Audio',
      parentId: root.id,
      isSynthetic: true,
    },
    update: {},
  });
  const stationery = await db.category.upsert({
    where: { slug: 'demo-stationery' },
    create: {
      slug: 'demo-stationery',
      name: 'DEMO Stationery',
      isSynthetic: true,
    },
    update: {},
  });
  const merchants = [];
  for (const suffix of ['alpha', 'beta']) {
    merchants.push(
      await db.merchant.upsert({
        where: { websiteUrl: `https://${suffix}.example.invalid` },
        create: {
          name: `DEMO ${suffix}`,
          sourceType: 'SYNTHETIC',
          websiteUrl: `https://${suffix}.example.invalid`,
          enabled: true,
          storageAuthorized: true,
          retentionSeconds: 86400,
          isSynthetic: true,
        },
        update: {},
      }),
    );
  }
  const importer = new OfferIngestionService(db, 'development');
  const now = new Date().toISOString();
  const fixtures = [
    {
      id: 'headphones',
      name: 'DEMO Headphones',
      price: 99.99,
      reference: 129.99,
      currency: 'USD',
      market: 'US',
      category: child.id,
    },
    {
      id: 'cable',
      name: 'DEMO USB Cable',
      price: 15,
      reference: 20,
      currency: 'USD',
      market: 'US',
      category: root.id,
    },
    {
      id: 'notebook',
      name: 'DEMO Notebook',
      price: 8.5,
      reference: 8.5,
      currency: 'EUR',
      market: 'DE',
      category: stationery.id,
    },
    {
      id: 'pen',
      name: 'DEMO Precision Pen',
      price: 1.234567,
      reference: 2.345678,
      currency: 'LYD',
      market: 'LY',
      category: stationery.id,
    },
    {
      id: 'audio-eur',
      name: 'DEMO Headphones',
      price: 80,
      reference: 100,
      currency: 'EUR',
      market: 'FR',
      category: child.id,
    },
  ];
  for (const merchant of merchants) {
    await importer.ingest(
      merchant.id,
      fixtures.map((row) => ({
        categoryId: row.category,
        product: {
          externalId: row.id,
          store: merchant.name,
          name: row.name,
          description:
            'SYNTHETIC DEVELOPMENT DATA. Not a commercial product or offer.',
          currentPrice: row.price,
          originalPrice: row.reference,
          currency: row.currency,
          market: row.market,
          productUrl: `${merchant.websiteUrl}/products/${row.id}`,
          fetchedAt: now,
          availability: 'available',
        },
      })),
    );
  }
  // Known missing data and expired data exercise read behavior; no price history.
  const alpha = merchants[0]!;
  const incomplete = await importer.ingest(alpha.id, [
    {
      product: {
        externalId: 'missing-price',
        store: alpha.name,
        name: 'DEMO Product Without Price',
        fetchedAt: now,
      },
    },
  ]);
  const expired = await importer.ingest(alpha.id, [
    {
      product: {
        externalId: 'expired',
        store: alpha.name,
        name: 'DEMO Expired Offer',
        currentPrice: 5,
        originalPrice: 10,
        currency: 'USD',
        fetchedAt: now,
      },
    },
  ]);
  const past = new Date(Date.now() - 1000);
  await db.offer.update({
    where: { id: expired.offerIds[0]! },
    data: { lastUpdatedAt: new Date(Date.now() - 86400000), expiresAt: past },
  });
  return {
    merchants: merchants.map((row) => row.id),
    categories: [root.id, child.id, stationery.id],
    incompleteOfferId: incomplete.offerIds[0],
    expiredOfferId: expired.offerIds[0],
  };
}
