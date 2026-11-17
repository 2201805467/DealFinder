import 'dotenv/config';
import { z } from 'zod';
import { ProviderError } from '../providers/provider-error.js';

const schema = z.object({
  BESTBUY_API_KEY: z.string().trim().min(1),
  BESTBUY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000),
});

export function parseBestBuyEnvironment(input: NodeJS.ProcessEnv) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ProviderError(
      'CONFIGURATION',
      'Set BESTBUY_API_KEY to an activated developer key and BESTBUY_TIMEOUT_MS to 100..60000 in backend/.env.',
    );
  }
  return {
    apiKey: result.data.BESTBUY_API_KEY,
    timeoutMs: result.data.BESTBUY_TIMEOUT_MS,
  };
}
