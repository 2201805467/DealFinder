import type { PrismaClient } from '../generated/prisma/client.js';
export const reviewedSources = {
  cheapshark: {
    name: 'CheapShark',
    sourceType: 'CHEAPSHARK' as const,
    websiteUrl: 'https://www.cheapshark.com/',
    authorizationReference:
      'https://apidocs.cheapshark.com/ — reviewed 2026-11-19; bounded manual sample only; required redirect links',
    retentionSeconds: 1800,
    syncIntervalSeconds: 1800,
    staleAfterSeconds: 1800,
  },
  gamerpower: {
    name: 'GamerPower',
    sourceType: 'GAMERPOWER' as const,
    websiteUrl: 'https://www.gamerpower.com/',
    authorizationReference:
      'https://www.gamerpower.com/api-read — reviewed 2026-11-19; attribution required; no data resale',
    retentionSeconds: 600,
    syncIntervalSeconds: 300,
    staleAfterSeconds: 600,
  },
};
/** Explicit CLI initialization; never imported by API startup or automatic seed. */
export async function prepareRealSource(
  db: PrismaClient,
  key: keyof typeof reviewedSources,
) {
  let parentId: string | undefined;
  for (const [slug, name, parent] of [
    ['digital-products', 'Digital Products', false],
    ['gaming', 'Gaming', true],
    ['pc-games', 'PC Games', true],
    ['free-games', 'Free Games', true],
    ['giveaways', 'Giveaways', true],
    ['dlc', 'DLC', true],
  ] as const) {
    const existing = await db.category.findUnique({ where: { slug } });
    if (existing?.isSynthetic)
      throw new Error('Category slug is reserved by synthetic data.');
    const category = await db.category.upsert({
      where: { slug },
      create: { slug, name, ...(parent && parentId && { parentId }) },
      update: {},
    });
    if (slug === 'digital-products' || slug === 'gaming')
      parentId = category.id;
  }
  const config = reviewedSources[key];
  const existing = await db.merchant.findUnique({
    where: { websiteUrl: config.websiteUrl },
  });
  if (
    existing &&
    (existing.sourceType !== config.sourceType ||
      existing.isSynthetic ||
      !existing.isDataSource)
  )
    throw new Error('Source identity conflicts with an existing merchant.');
  return db.merchant.upsert({
    where: { websiteUrl: config.websiteUrl },
    create: {
      ...config,
      isDataSource: true,
      enabled: true,
      storageAuthorized: true,
      syncEnabled: true,
    },
    update: {},
  });
}
