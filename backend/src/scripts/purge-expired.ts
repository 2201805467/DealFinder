import 'dotenv/config';
import { createDatabaseClient } from '../database/client.js';
import { OfferIngestionService } from '../services/offer-ingestion.js';

const db = createDatabaseClient(process.env.DATABASE_URL ?? '');
try {
  console.log(
    JSON.stringify(
      await new OfferIngestionService(
        db,
        process.env.NODE_ENV ?? 'development',
      ).purgeExpired(),
    ),
  );
} catch {
  console.error('Expired content purge failed.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
