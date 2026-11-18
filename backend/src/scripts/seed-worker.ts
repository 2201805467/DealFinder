import 'dotenv/config';
import { createDatabaseClient } from '../database/client.js';
import { assertDevelopmentDatabase } from '../database/development-guard.js';

try {
  assertDevelopmentDatabase(
    process.env.NODE_ENV,
    process.env.DATABASE_URL ?? '',
  );
  const db = createDatabaseClient(process.env.DATABASE_URL!);
  try {
    await db.merchant.upsert({
      where: { websiteUrl: 'https://worker.example.invalid' },
      create: {
        name: 'SYNTHETIC Worker DEMO Store',
        sourceType: 'SYNTHETIC',
        websiteUrl: 'https://worker.example.invalid',
        isSynthetic: true,
        enabled: true,
        storageAuthorized: true,
        retentionSeconds: 86400,
        syncEnabled: true,
        syncIntervalSeconds: 300,
        staleAfterSeconds: 900,
      },
      update: { syncEnabled: true },
    });
    console.log(
      'SYNTHETIC demo source registered. No products fetched. Worker still requires explicit environment opt-in.',
    );
  } finally {
    await db.$disconnect();
  }
} catch {
  console.error(
    'Worker demo seed requires a migrated local development database.',
  );
  process.exitCode = 1;
}
