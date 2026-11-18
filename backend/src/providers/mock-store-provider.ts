import type {
  ProductPage,
  ProductSearch,
  StoreProduct,
  StoreProvider,
} from './store-provider.js';

// Never registered in production. No network access or externally sourced content.
export class MockStoreProvider implements StoreProvider {
  constructor(readonly name: string) {}
  async searchProducts(
    search: ProductSearch = {},
    context?: { signal?: AbortSignal },
  ): Promise<ProductPage> {
    context?.signal?.throwIfAborted();
    const page = search.page ?? 1;
    const pageSize = search.pageSize ?? 20;
    const prices = [15, 99.99, 8.5, 20, 1.234567];
    let products: StoreProduct[] = prices.map((price, index) => ({
      externalId: `worker-demo-${index + 1}`,
      store: this.name,
      name: `SYNTHETIC Worker DEMO Product ${index + 1}`,
      description: 'Generated test fixture. Not a commercial offer.',
      currentPrice: price,
      originalPrice: index === 2 ? price : Number((price * 2).toFixed(6)),
      currency: 'USD',
      market: 'US',
      availability: 'available',
      productUrl: `https://worker.example.invalid/products/${index + 1}`,
      fetchedAt: new Date().toISOString(),
    }));
    if (search.query)
      products = products.filter((row) =>
        row.name.toLowerCase().includes(search.query!.toLowerCase()),
      );
    if (search.discountedOnly)
      products = products.filter(
        (row) => row.originalPrice! > row.currentPrice!,
      );
    return {
      products: products.slice((page - 1) * pageSize, page * pageSize),
      total: products.length,
      totalPages: Math.ceil(products.length / pageSize),
      page,
      skippedCount: 0,
    };
  }
}
