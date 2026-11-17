import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { ProviderError } from '../provider-error.js';
import type {
  ProductPage,
  ProductSearch,
  StoreProvider,
} from '../store-provider.js';
import { normalizeBestBuyProduct } from './normalize.js';

const searchSchema = z
  .object({
    // Reject API filter operators rather than interpreting untrusted filter syntax.
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\p{L}\p{N}\s-]+$/u)
      .optional(),
    discountedOnly: z.boolean().default(false),
    pageSize: z.number().int().min(1).max(100).default(20),
    page: z.number().int().min(1).max(10).optional(),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .refine((value) => !(value.page !== undefined && value.cursor !== undefined));

const responseSchema = z.object({
  products: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  currentPage: z.number().int().positive().optional(),
  nextCursorMark: z.string().optional(),
  partial: z.boolean().optional(),
});

type Fetch = typeof globalThis.fetch;
interface Options {
  apiKey: string;
  timeoutMs?: number;
  fetch?: Fetch;
}

export class BestBuyProvider implements StoreProvider {
  readonly name = 'Best Buy';
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: Fetch;
  #queue: Promise<void> = Promise.resolve();
  #nextRequestAt = 0;
  #blockedUntil = 0;

  constructor(options: Options) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (
      !options.apiKey.trim() ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 60_000
    ) {
      throw new ProviderError(
        'CONFIGURATION',
        'Best Buy requires an API key and a timeout of 100..60000 ms.',
      );
    }
    this.#apiKey = options.apiKey.trim();
    this.#timeoutMs = timeoutMs;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async searchProducts(search: ProductSearch = {}): Promise<ProductPage> {
    const parsed = searchSchema.safeParse(search);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_SEARCH',
        'Use page 1..10 or a cursor, pageSize 1..100 and plain search words.',
      );
    }
    const options = parsed.data;
    const filters = ['type=HardGood', 'active=true'];
    if (options.discountedOnly) filters.push('onSale=true');
    if (options.query) {
      for (const word of options.query.split(/\s+/))
        filters.push(`search=${encodeURIComponent(word)}`);
    }
    const url = new URL(
      `https://api.bestbuy.com/v1/products(${filters.join('&')})`,
    );
    url.searchParams.set('apiKey', this.#apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set(
      'show',
      'sku,name,type,shortDescription,image,salePrice,regularPrice,onSale,priceRestriction,url,onlineAvailability',
    );
    url.searchParams.set('pageSize', String(options.pageSize));
    if (options.cursor !== undefined)
      url.searchParams.set('cursorMark', options.cursor);
    else url.searchParams.set('page', String(options.page ?? 1));

    // Serialize starts with >=250ms spacing (<=4/s) per instance. A CLI run makes
    // one request. Multi-process/global daily quotas require coordination later.
    const previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await sleep(Math.max(0, this.#nextRequestAt - Date.now()));
      if (Date.now() < this.#blockedUntil) {
        throw new ProviderError(
          'RATE_LIMIT',
          'Best Buy cooldown is active; try again later.',
          Math.ceil((this.#blockedUntil - Date.now()) / 1000),
        );
      }
      this.#nextRequestAt = Date.now() + 250;
    } finally {
      release();
    }

    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new ProviderError(
          'ACCESS_OR_QUOTA',
          'Best Buy rejected access: verify the activated key and account quota. No automatic retry.',
        );
      }
      if (response.status === 429) {
        const header = response.headers.get('retry-after');
        const seconds =
          header !== null && /^\d+$/.test(header)
            ? Number(header)
            : header !== null
              ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
              : NaN;
        const retryAfter =
          Number.isFinite(seconds) && seconds >= 0 ? Math.max(1, seconds) : 60;
        this.#blockedUntil = Date.now() + retryAfter * 1000;
        await response.body?.cancel();
        throw new ProviderError(
          'RATE_LIMIT',
          'Best Buy rate limit reached; retry after the cooldown.',
          retryAfter,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
          'UPSTREAM',
          `Best Buy request failed (HTTP ${response.status}).`,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (signal.aborted)
          throw new ProviderError('TIMEOUT', 'Best Buy request timed out.');
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Best Buy returned invalid JSON.',
        );
      }
      const result = responseSchema.safeParse(payload);
      if (!result.success)
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Best Buy response does not match the expected product collection.',
        );
      const data = result.data;
      const fetchedAt = new Date().toISOString();
      const products = data.products.flatMap((product) => {
        const normalized = normalizeBestBuyProduct(product, fetchedAt);
        return normalized ? [normalized] : [];
      });
      return {
        products,
        total: data.total,
        totalPages: data.totalPages,
        ...(options.cursor === undefined && {
          page: data.currentPage ?? options.page ?? 1,
        }),
        ...(data.nextCursorMark &&
          data.nextCursorMark !== options.cursor &&
          data.products.length > 0 && { nextCursor: data.nextCursorMark }),
        ...(data.partial !== undefined && { partial: data.partial }),
        skippedCount: data.products.length - products.length,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (signal.aborted)
        throw new ProviderError('TIMEOUT', 'Best Buy request timed out.');
      throw new ProviderError('NETWORK', 'Best Buy network request failed.');
    }
  }
}
