import { parseArgs } from 'node:util';
import { parseBestBuyEnvironment } from '../config/bestbuy.js';
import { BestBuyProvider } from '../providers/bestbuy/bestbuy-provider.js';
import { ProviderError } from '../providers/provider-error.js';

try {
  const { values } = parseArgs({
    options: {
      query: { type: 'string' },
      limit: { type: 'string', default: '20' },
      page: { type: 'string' },
      cursor: { type: 'string' },
      'all-products': { type: 'boolean', default: false },
    },
  });
  const provider = new BestBuyProvider(parseBestBuyEnvironment(process.env));
  const result = await provider.searchProducts({
    pageSize: Number(values.limit),
    discountedOnly: !values['all-products'],
    ...(values.query !== undefined && { query: values.query }),
    ...(values.page !== undefined && { page: Number(values.page) }),
    ...(values.cursor !== undefined && { cursor: values.cursor }),
  });
  console.log(
    'LIVE Best Buy API response (not mock data). Source: Best Buy. No data saved.',
  );
  console.table(
    result.products.map((product) => ({
      name: product.name,
      currentPrice: product.currentPrice ?? 'not available / restricted',
      originalPrice: product.originalPrice ?? 'not available',
      discountPercentage: product.discountPercentage ?? 'not available',
      currency: product.currency,
      url: product.productUrl ?? 'not available',
    })),
  );
  console.log(
    JSON.stringify({
      fetchedProducts: result.products.length,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      nextCursor: result.nextCursor,
      skippedCount: result.skippedCount,
      partial: result.partial,
    }),
  );
  if (result.products.length === 0)
    console.log(
      'No products returned; this does not verify a non-empty product integration.',
    );
} catch (error) {
  if (error instanceof ProviderError) {
    console.error(
      JSON.stringify({
        code: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      }),
    );
  } else {
    // Includes argument parsing failures. Do not echo user arguments or raw errors.
    console.error(
      'Best Buy sample failed. Check CLI arguments and provider configuration.',
    );
  }
  process.exitCode = 1;
}
