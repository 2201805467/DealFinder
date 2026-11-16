import { parseEnvironment } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createDatabaseClient } from './client.js';

try {
  const config = parseEnvironment(process.env);
  const database = createDatabaseClient(config.DATABASE_URL);
  try {
    await database.$queryRaw`SELECT 1`;
    logger.info('PostgreSQL connection verified');
  } finally {
    await database.$disconnect();
  }
} catch {
  logger.error(
    'Database check failed. Verify environment variables and PostgreSQL availability.',
  );
  process.exitCode = 1;
}
