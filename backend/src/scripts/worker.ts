import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '../database/client.js';
import {
  assertDemoWorkerEnabled,
  parseWorkerEnvironment,
  assertRealWorkerEnabled,
} from '../config/worker.js';
import { demoRegistry, realRegistry } from '../services/provider-registry.js';
import { ProductSynchronizationService } from '../services/product-synchronization.js';
import { BackgroundWorker } from '../jobs/background-worker.js';
import { logger } from '../utils/logger.js';

try {
  const { values } = parseArgs({
    options: {
      once: { type: 'boolean', default: false },
      real: { type: 'boolean', default: false },
    },
  });
  const options = parseWorkerEnvironment(process.env);
  const environment = process.env.NODE_ENV ?? '';
  if (values.real) assertRealWorkerEnabled(environment, options);
  else assertDemoWorkerEnabled(environment, options);
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
      values.real ? realRegistry() : demoRegistry(),
      options,
      environment,
    );
    const worker = new BackgroundWorker(
      db,
      service,
      options,
      environment,
      values.real ? 'real' : 'demo',
    );
    logger.info(
      values.real
        ? 'Reviewed real-data worker starting'
        : 'SYNTHETIC demo worker starting',
      { once: values.once },
    );
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
