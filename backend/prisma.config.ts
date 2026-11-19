import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx src/scripts/seed.ts' },
  // CLI may use a separate migration principal. Runtime always uses DATABASE_URL.
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL || env('DATABASE_URL'),
  },
});
