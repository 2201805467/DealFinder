import { z } from 'zod';
import { ProviderError } from '../provider-error.js';
import type {
  ProductPage,
  ProductSearch,
  StoreProvider,
} from '../store-provider.js';
import { normalizeWooCommerceProduct } from './normalize.js';
import {
  assertStoreUrl,
  boundedProviderJson,
  safeStoreFetch,
} from '../safe-http.js';

interface Options {
  baseUrl: string;
  storeName: string;
  usage: 'local-test' | 'authorized';
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
const searchSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  discountedOnly: z.boolean().default(false),
  pageSize: z.number().int().min(1).max(100).default(20),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  cursor: z.never().optional(),
});
function paginationCount(value: string | null): number {
  if (
    value === null ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'WooCommerce pagination headers are missing or invalid.',
    );
  }
  return Number(value);
}

export class WooCommerceProvider implements StoreProvider {
  readonly name: string;
  readonly #endpoint: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  #blockedUntil = 0;

  constructor(options: Options) {
    let base: URL;
    try {
      base = new URL(options.baseUrl);
    } catch {
      throw new ProviderError(
        'CONFIGURATION',
        'WooCommerce requires a valid store base URL.',
      );
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
      base.hostname,
    );
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !['http:', 'https:'].includes(base.protocol) ||
      !['local-test', 'authorized'].includes(options.usage) ||
      (options.usage === 'local-test' && !loopback) ||
      (options.usage === 'authorized' && base.protocol !== 'https:') ||
      !options.storeName.trim()
    ) {
      throw new ProviderError(
        'CONFIGURATION',
        'Use a loopback store for local-test, or an HTTPS store with confirmed permission for authorized usage. Do not include credentials, query parameters or fragments.',
      );
    }
    const timeout = options.timeoutMs ?? 10000;
    assertStoreUrl(base, options.usage === 'local-test');
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) {
      throw new ProviderError(
        'CONFIGURATION',
        'WooCommerce timeout must be 100..60000 ms.',
      );
    }
    base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
    this.#endpoint = new URL('wp-json/wc/store/v1/products', base);
    this.name = options.storeName.trim();
    this.#fetch =
      options.fetch ?? safeStoreFetch(options.usage === 'local-test');
    this.#timeoutMs = timeout;
  }

  async searchProducts(
    search: ProductSearch = {},
    context?: { signal?: AbortSignal },
  ): Promise<ProductPage> {
    const parsed = searchSchema.safeParse(search);
    if (!parsed.success)
      throw new ProviderError(
        'INVALID_SEARCH',
        'Use page >=1, pageSize 1..100 and optional search text. Cursor pagination is unsupported.',
      );
    if (Date.now() < this.#blockedUntil)
      throw new ProviderError(
        'RATE_LIMIT',
        'WooCommerce cooldown is active.',
        Math.ceil((this.#blockedUntil - Date.now()) / 1000),
      );
    const options = parsed.data;
    const url = new URL(this.#endpoint);
    url.searchParams.set('page', String(options.page));
    url.searchParams.set('per_page', String(options.pageSize));
    if (options.query) url.searchParams.set('search', options.query);
    if (options.discountedOnly) url.searchParams.set('on_sale', 'true');
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = context?.signal
      ? AbortSignal.any([timeout, context.signal])
      : timeout;
    try {
      const response = await this.#fetch(url, {
        signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        if (response.status === 429) {
          const header = response.headers.get('retry-after');
          const seconds =
            header !== null && /^\d+$/.test(header)
              ? Number(header)
              : header !== null
                ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
                : NaN;
          const wait =
            Number.isFinite(seconds) && seconds >= 0
              ? Math.max(1, seconds)
              : 60;
          this.#blockedUntil = Date.now() + wait * 1000;
          await response.body?.cancel();
          throw new ProviderError(
            'RATE_LIMIT',
            'WooCommerce rate limit reached.',
            wait,
          );
        }
        await response.body?.cancel();
        throw new ProviderError(
          response.status === 401 || response.status === 403
            ? 'ACCESS_OR_QUOTA'
            : 'UPSTREAM',
          `WooCommerce request failed (HTTP ${response.status}).`,
        );
      }
      let payload: unknown;
      try {
        payload = await boundedProviderJson(response, signal);
      } catch {
        if (signal.aborted)
          throw new ProviderError('TIMEOUT', 'WooCommerce request timed out.');
        throw new ProviderError(
          'INVALID_RESPONSE',
          'WooCommerce returned invalid JSON.',
        );
      }
      if (!Array.isArray(payload))
        throw new ProviderError(
          'INVALID_RESPONSE',
          'WooCommerce did not return a product array.',
        );
      const total = paginationCount(response.headers.get('x-wp-total'));
      const totalPages = paginationCount(
        response.headers.get('x-wp-totalpages'),
      );
      const fetchedAt = new Date().toISOString();
      const products = payload.flatMap((input: unknown) => {
        const product = normalizeWooCommerceProduct(
          input,
          this.name,
          fetchedAt,
        );
        return product ? [product] : [];
      });
      return {
        products,
        total,
        totalPages,
        page: options.page,
        skippedCount: payload.length - products.length,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        signal.aborted ? 'TIMEOUT' : 'NETWORK',
        signal.aborted
          ? 'WooCommerce request timed out.'
          : 'WooCommerce network request failed.',
      );
    }
  }
}
