import { parseArgs } from 'node:util';
import { parseWooCommerceEnvironment } from '../config/woocommerce.js';
import { WooCommerceProvider } from '../providers/woocommerce/woocommerce-provider.js';
import { ProviderError } from '../providers/provider-error.js';

try {
  const { values } = parseArgs({
    options: {
      query: { type: 'string' },
      limit: { type: 'string', default: '20' },
      page: { type: 'string', default: '1' },
      'on-sale': { type: 'boolean', default: false },
    },
  });
  const config = parseWooCommerceEnvironment(process.env);
  const provider = new WooCommerceProvider(config);
  const result = await provider.searchProducts({
    pageSize: Number(values.limit),
    page: Number(values.page),
    discountedOnly: values['on-sale'],
    ...(values.query !== undefined && { query: values.query }),
  });
  console.log(
    config.usage === 'local-test'
      ? 'LOCAL TEST WooCommerce HTTP response. Demo products only; not commercial offers.'
      : 'AUTHORIZED STORE WooCommerce HTTP response. Permission must cover use of this data.',
  );
  console.table(
    result.products.map((product) => ({
      name: product.name,
      currentPrice: product.currentPrice ?? 'not available',
      originalPrice: product.originalPrice ?? 'not available',
      discountPercentage: product.discountPercentage ?? 'not available',
      currency: product.currency ?? 'not available',
      url: product.productUrl ?? 'not available',
    })),
  );
  console.log(
    JSON.stringify({
      fetchedProducts: result.products.length,
      total: result.total,
      totalPages: result.totalPages,
      page: result.page,
      skippedCount: result.skippedCount,
    }),
  );
} catch (error) {
  console.error(
    error instanceof ProviderError
      ? JSON.stringify({
          code: error.code,
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        })
      : 'WooCommerce sample failed. Check CLI arguments and configuration.',
  );
  process.exitCode = 1;
}
