import { z } from 'zod';
import type { StoreProduct } from '../store-provider.js';

const text = z.string().min(1).optional().catch(undefined);
const boolean = z.boolean().optional().catch(undefined);
const url = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value))
  .optional()
  .catch(undefined);
const pricesSchema = z.object({
  currency_code: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .catch(undefined),
  currency_minor_unit: z
    .number()
    .int()
    .min(0)
    .max(6)
    .optional()
    .catch(undefined),
  price: z.unknown().optional(),
  regular_price: z.unknown().optional(),
  sale_price: z.unknown().optional(),
  price_range: z.unknown().optional(),
});
const schema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1),
  type: text,
  permalink: url,
  short_description: text,
  on_sale: boolean,
  is_in_stock: boolean,
  is_purchasable: boolean,
  images: z
    .array(z.object({ src: url }))
    .optional()
    .catch(undefined),
  prices: pricesSchema.optional().catch(undefined),
});

// The API's price strings are integer minor units, never decimal display strings.
export function minorUnitAmount(
  value: unknown,
  minorUnit: unknown,
): number | undefined {
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    typeof minorUnit !== 'number' ||
    !Number.isInteger(minorUnit) ||
    minorUnit < 0 ||
    minorUnit > 6
  )
    return undefined;
  const units = Number(value);
  if (!Number.isSafeInteger(units)) return undefined;
  return units / 10 ** minorUnit;
}

export function normalizeWooCommerceProduct(
  input: unknown,
  storeName: string,
  fetchedAt: string,
): StoreProduct | undefined {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return undefined;
  const product = parsed.data;
  const prices = product.prices;
  // A range/group may combine prices from different variations. The current
  // scalar model cannot faithfully describe it; omit prices until a variant is selected.
  const comparable =
    product.type !== undefined &&
    ['simple', 'variation', 'external'].includes(product.type) &&
    prices?.currency_code !== undefined &&
    prices.price_range === null;
  const currentPrice = comparable
    ? minorUnitAmount(prices.price, prices.currency_minor_unit)
    : undefined;
  const regular = comparable
    ? minorUnitAmount(prices.regular_price, prices.currency_minor_unit)
    : undefined;
  const sale = comparable
    ? minorUnitAmount(prices.sale_price, prices.currency_minor_unit)
    : undefined;
  const originalPrice =
    regular !== undefined &&
    (currentPrice === undefined || regular >= currentPrice)
      ? regular
      : undefined;
  const discountPercentage =
    product.on_sale === true &&
    currentPrice !== undefined &&
    originalPrice !== undefined &&
    originalPrice > 0 &&
    originalPrice > currentPrice &&
    sale === currentPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 10000) /
        100
      : undefined;
  const availability =
    product.is_in_stock === false || product.is_purchasable === false
      ? ('unavailable' as const)
      : product.is_in_stock === true && product.is_purchasable === true
        ? ('available' as const)
        : undefined;
  const imageUrl = product.images?.find(
    (image) => image.src !== undefined,
  )?.src;

  return {
    externalId: String(product.id),
    store: storeName,
    name: product.name,
    fetchedAt,
    // WooCommerce descriptions may contain HTML. Preserve as data, never render as trusted HTML.
    ...(product.short_description !== undefined && {
      description: product.short_description,
    }),
    ...(imageUrl !== undefined && { imageUrl }),
    ...(product.permalink !== undefined && { productUrl: product.permalink }),
    ...(prices?.currency_code !== undefined && {
      currency: prices.currency_code,
    }),
    ...(currentPrice !== undefined && { currentPrice }),
    ...(originalPrice !== undefined && { originalPrice }),
    ...(discountPercentage !== undefined && { discountPercentage }),
    ...(availability !== undefined && { availability }),
  };
}
