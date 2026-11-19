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
  source?: SourceMetadata;
}

/** Metadata from a reviewed aggregator, distinct from the actual seller. */
export interface SourceMetadata {
  key: 'CHEAPSHARK' | 'GAMERPOWER';
  itemId: string;
  retailerId: string;
  platforms: string[];
  kind: 'game' | 'loot' | 'dlc' | 'beta' | 'giveaway';
  attributionUrl: string;
  referencePriceTrusted: boolean;
  endsAt?: string;
  endText?: string;
}
export interface ProviderContext {
  signal?: AbortSignal;
  onRequest?: () => Promise<void>;
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
  total?: number;
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
  readonly resumeAcrossRuns?: boolean;
  readonly reportsRequests?: boolean;
  readonly maxPageSize?: number;
  beginRun?(): void;
  searchProducts(
    search?: ProductSearch,
    context?: ProviderContext,
  ): Promise<ProductPage>;
}
