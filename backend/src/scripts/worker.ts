import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '../database/client.js';
import {
  assertDemoWorkerEnabled,
  parseWorkerEnvironment,
} from '../config/worker.js';
import { demoRegistry } from '../services/provider-registry.js';
import { ProductSynchronizationService } from '../services/product-synchronization.js';
import { BackgroundWorker } from '../jobs/background-worker.js';
import { logger } from '../utils/logger.js';

try {
  const { values } = parseArgs({
    options: { once: { type: 'boolean', default: false } },
  });
  const options = parseWorkerEnvironment(process.env);
  const environment = process.env.NODE_ENV ?? '';
  assertDemoWorkerEnabled(environment, options);
  const db = createDatabaseClient(process.env.DATABASE_URL ?? '');
  const controller = new AbortController();
  const stop = () => {
    logger.info('Worker shutdown requested');
    controller.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const service = new ProductSynchronizationService(
      db,
      demoRegistry(),
      options,
      environment,
    );
    const worker = new BackgroundWorker(db, service, options, environment);
    logger.info('SYNTHETIC demo worker starting', { once: values.once });
    if (values.once) {
      const results = await worker.tick(controller.signal, true);
      if (
        results.some(
          (row) =>
            ['FAILED', 'PARTIAL', 'CANCELLED'].includes(row.status) ||
            row.errorCode === 'COORDINATOR_FAILED',
        )
      )
        process.exitCode = 1;
    } else await worker.start(controller.signal);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await db.$disconnect();
  }
} catch {
  logger.error(
    'Worker did not start. Check explicit demo opt-in, NODE_ENV, database and bounded worker settings.',
  );
  process.exitCode = 1;
}
