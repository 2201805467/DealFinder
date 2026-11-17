import 'dotenv/config';
import { z } from 'zod';
import { ProviderError } from '../providers/provider-error.js';

const schema = z.object({
  WOOCOMMERCE_BASE_URL: z.url(),
  WOOCOMMERCE_STORE_NAME: z.string().trim().min(1),
  WOOCOMMERCE_USAGE: z.enum(['local-test', 'authorized']),
  WOOCOMMERCE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(10000),
});

export function parseWooCommerceEnvironment(input: NodeJS.ProcessEnv) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ProviderError(
      'CONFIGURATION',
      'Set WOOCOMMERCE_BASE_URL, WOOCOMMERCE_STORE_NAME, WOOCOMMERCE_USAGE (local-test or authorized) and a timeout of 100..60000 ms.',
    );
  return {
    baseUrl: result.data.WOOCOMMERCE_BASE_URL,
    storeName: result.data.WOOCOMMERCE_STORE_NAME,
    usage: result.data.WOOCOMMERCE_USAGE,
    timeoutMs: result.data.WOOCOMMERCE_TIMEOUT_MS,
  };
}
