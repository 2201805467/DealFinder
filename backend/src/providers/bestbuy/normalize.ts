import { z } from 'zod';
import type { StoreProduct } from '../store-provider.js';

const optionalText = z.string().min(1).optional().catch(undefined);
const optionalPrice = z
  .number()
  .finite()
  .positive()
  .optional()
  .catch(undefined);
const optionalBoolean = z.boolean().optional().catch(undefined);
const optionalUrl = z
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value))
  .optional()
  .catch(undefined);

const productSchema = z.object({
  sku: z.number().int().positive(),
  name: z.string().min(1).max(500),
  shortDescription: optionalText,
  image: optionalUrl,
  url: optionalUrl,
  salePrice: optionalPrice,
  regularPrice: optionalPrice,
  onSale: optionalBoolean,
  onlineAvailability: optionalBoolean,
  priceRestriction: z.unknown().optional(),
  type: z.string(),
});

export function normalizeBestBuyProduct(
  input: unknown,
  fetchedAt: string,
): StoreProduct | undefined {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const product = parsed.data;
  // Exclude licensed media and bundles; the first integration is hardware only.
  if (product.type.toLowerCase() !== 'hardgood') return undefined;

  // Only an explicitly empty/null restriction is safe; missing or unfamiliar values
  // do not grant permission to display a price.
  const priceRestricted =
    product.priceRestriction !== null && product.priceRestriction !== '';
  const currentPrice = priceRestricted ? undefined : product.salePrice;
  const originalPrice =
    !priceRestricted &&
    product.regularPrice !== undefined &&
    (currentPrice === undefined || product.regularPrice >= currentPrice)
      ? product.regularPrice
      : undefined;
  const discountPercentage =
    product.onSale === true &&
    currentPrice !== undefined &&
    originalPrice !== undefined &&
    originalPrice > currentPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 10_000) /
        100
      : undefined;

  return {
    externalId: String(product.sku),
    store: 'Best Buy',
    name: product.name,
    ...(product.shortDescription !== undefined && {
      description: product.shortDescription,
    }),
    ...(product.image !== undefined && { imageUrl: product.image }),
    ...(product.url !== undefined && { productUrl: product.url }),
    ...(currentPrice !== undefined && { currentPrice }),
    ...(originalPrice !== undefined && { originalPrice }),
    ...(discountPercentage !== undefined && { discountPercentage }),
    ...(product.onlineAvailability !== undefined && {
      availability: product.onlineAvailability
        ? ('available' as const)
        : ('unavailable' as const),
    }),
    // Source context: BestBuy.com US catalog, not per-product shipping coverage.
    currency: 'USD',
    market: 'US',
    priceRestricted,
    fetchedAt,
  };
}
