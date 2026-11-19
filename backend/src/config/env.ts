import 'dotenv/config';
import { z } from 'zod';

const httpOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}, 'Use an exact HTTP(S) origin without a trailing slash or path');

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .default(300),
    DATABASE_URL: z.url().refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['postgresql:', 'postgres:'].includes(url.protocol) && !!url.hostname
        );
      } catch {
        return false;
      }
    }, 'DATABASE_URL must be a PostgreSQL connection URL'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(httpOrigin)),
    CATALOG_INCLUDE_SYNTHETIC: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;
    let url: URL;
    try {
      url = new URL(value.DATABASE_URL);
    } catch {
      return;
    }
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.searchParams.get('sslmode') !== 'verify-full'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Remote production database requires verified TLS.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report field names only, never connection strings or credentials.
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid environment variables: ${fields.join(', ')}`);
  }
  return result.data;
}
