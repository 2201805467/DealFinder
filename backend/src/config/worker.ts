import 'dotenv/config';
import { z } from 'zod';

const integer = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  WORKER_ENABLED: z.enum(['true', 'false']).default('false'),
  WORKER_ALLOW_SYNTHETIC: z.enum(['true', 'false']).default('false'),
  WORKER_POLL_MS: integer(100, 60000, 5000),
  WORKER_CLEANUP_MS: integer(1000, 86400000, 60000),
  WORKER_REQUEST_TIMEOUT_MS: integer(50, 60000, 10000),
  WORKER_MAX_RUN_MS: integer(100, 300000, 60000),
  WORKER_MAX_PAGES: integer(1, 100, 10),
  WORKER_MAX_PRODUCTS: integer(1, 10000, 200),
  WORKER_MAX_REQUESTS: integer(1, 500, 20),
  WORKER_PAGE_SIZE: integer(1, 100, 20),
  WORKER_MAX_RETRIES: integer(0, 10, 3),
  WORKER_BACKOFF_MS: integer(1, 60000, 500),
  WORKER_MAX_BACKOFF_MS: integer(1, 300000, 30000),
});
export function parseWorkerEnvironment(input: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      'Invalid worker configuration. Check bounded WORKER_* settings.',
    );
  const v = parsed.data;
  return {
    enabled: v.WORKER_ENABLED === 'true',
    allowSynthetic: v.WORKER_ALLOW_SYNTHETIC === 'true',
    pollMs: v.WORKER_POLL_MS,
    cleanupMs: v.WORKER_CLEANUP_MS,
    requestTimeoutMs: v.WORKER_REQUEST_TIMEOUT_MS,
    maxRunMs: v.WORKER_MAX_RUN_MS,
    maxPages: v.WORKER_MAX_PAGES,
    maxProducts: v.WORKER_MAX_PRODUCTS,
    maxRequests: v.WORKER_MAX_REQUESTS,
    pageSize: v.WORKER_PAGE_SIZE,
    maxRetries: v.WORKER_MAX_RETRIES,
    backoffMs: v.WORKER_BACKOFF_MS,
    maxBackoffMs: v.WORKER_MAX_BACKOFF_MS,
  };
}
export type WorkerOptions = ReturnType<typeof parseWorkerEnvironment>;
export function assertDemoWorkerEnabled(
  environment: string | undefined,
  options: WorkerOptions,
) {
  if (
    !['development', 'test'].includes(environment ?? '') ||
    !options.enabled ||
    !options.allowSynthetic
  ) {
    throw new Error(
      'Demo worker requires NODE_ENV=development/test, WORKER_ENABLED=true and WORKER_ALLOW_SYNTHETIC=true. Production is prohibited.',
    );
  }
}
