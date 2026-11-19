export interface StoreProduct {
  externalId: string;
  store: string;
  name: string;
  description?: string;
  imageUrl?: string;
  currentPrice?: number;
  originalPrice?: number;
  currency?: string;
  discountPercentage?: number;
  productUrl?: string;
  // Online purchase availability, not a promise of shipping to the user's country.
  availability?: 'available' | 'unavailable';
  market?: string;
  fetchedAt: string;
  priceRestricted?: boolean;
}

export interface ProductSearch {
  query?: string;
  discountedOnly?: boolean;
  pageSize?: number;
  page?: number;
  cursor?: string;
}

export interface ProductPage {
  products: StoreProduct[];
  total: number;
  totalPages: number;
  page?: number;
  nextCursor?: string;
  partial?: boolean;
  skippedCount: number;
}

export interface StoreProvider {
  readonly name: string;
  // Optional explicit capability. Unstable catalogues cannot claim full coverage across runs.
  readonly checkpointVersion?: string;
  readonly stablePagination?: boolean;
  searchProducts(
    search?: ProductSearch,
    context?: { signal?: AbortSignal },
  ): Promise<ProductPage>;
}
