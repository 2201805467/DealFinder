import { createApp } from './app.js';
import { parseEnvironment } from './config/env.js';
import { logger } from './utils/logger.js';
import { createDatabaseClient } from './database/client.js';
import { CatalogService } from './services/catalog.js';

try {
  const config = parseEnvironment(process.env);
  const database = createDatabaseClient(config.DATABASE_URL);
  const server = createApp(
    config,
    new CatalogService(database, config.NODE_ENV !== 'production'),
  ).listen(config.PORT, config.HOST, () => {
    logger.info('Backend listening', { host: config.HOST, port: config.PORT });
  });
  server.on('error', () => {
    logger.error('HTTP server failed to start');
    process.exitCode = 1;
  });

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
} catch (error) {
  logger.error(error instanceof Error ? error.message : 'Startup failed');
  process.exitCode = 1;
}
