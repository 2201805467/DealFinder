import { createApp } from './app.js';
import { parseEnvironment } from './config/env.js';
import { logger } from './utils/logger.js';
import { createDatabaseClient } from './database/client.js';
import { CatalogService } from './services/catalog.js';
import { parseScoringRules } from './scoring/deal-scoring.js';

try {
  const config = parseEnvironment(process.env);
  const database = createDatabaseClient(config.DATABASE_URL);
  const server = createApp(
    config,
    new CatalogService(
      database,
      config.NODE_ENV !== 'production' && config.CATALOG_INCLUDE_SYNTHETIC,
      parseScoringRules(process.env.DEAL_SCORING_RULES),
    ),
  ).listen(config.PORT, config.HOST, () => {
    logger.info('Backend listening', { host: config.HOST, port: config.PORT });
  });
  server.on('error', () => {
    logger.error('HTTP server failed to start');
    void database.$disconnect();
    process.exitCode = 1;
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.info('Shutting down', { signal });
      const timeout = setTimeout(() => process.exit(1), 10_000);
      timeout.unref();
      server.close(() => {
        void database.$disconnect().finally(() => clearTimeout(timeout));
      });
    });
  }
} catch {
  logger.error(
    'Startup failed; verify environment, database and scoring configuration',
  );
  process.exitCode = 1;
}
