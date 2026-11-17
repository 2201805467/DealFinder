import 'dotenv/config';
import { assertDevelopmentDatabase } from '../database/development-guard.js';
import { createDatabaseClient } from '../database/client.js';
import { seedDevelopment } from '../database/seed.js';

try {
  const url = process.env.DATABASE_URL ?? '';
  assertDevelopmentDatabase(process.env.NODE_ENV, url);
  const db = createDatabaseClient(url);
  try {
    await seedDevelopment(db);
    console.log(
      'SYNTHETIC DEVELOPMENT seed applied without deleting existing data.',
    );
  } finally {
    await db.$disconnect();
  }
} catch {
  console.error(
    'Development seed failed. Verify the local database, migrations and development-only configuration.',
  );
  process.exitCode = 1;
}
