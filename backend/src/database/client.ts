import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function createDatabaseClient(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 10,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 330_000,
    // Concurrent API queries use one PostgreSQL worker each. Avoid multiplying
    // parallel hash joins beyond a small Docker /dev/shm budget.
    options: '-c max_parallel_workers_per_gather=0',
  });
  return new PrismaClient({ adapter });
}
