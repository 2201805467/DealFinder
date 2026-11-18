import { z } from 'zod';
import { AppError } from '../utils/app-error.js';

const amount = z
  .string()
  .regex(/^\d{1,18}(\.\d{1,6})?$/)
  .optional();
const schema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid().optional(),
    merchantId: z.uuid().optional(),
    market: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    minPrice: amount,
    maxPrice: amount,
    sort: z
      .enum([
        'price_asc',
        'price_desc',
        'discount_desc',
        'newest',
        'score_desc',
      ])
      .default('newest'),
    view: z.enum(['discounted', 'top', 'low_price']).optional(),
  })
  .strict();
export type CatalogQuery = z.infer<typeof schema>;
export function parseCatalogQuery(input: unknown): CatalogQuery {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      400,
      'INVALID_QUERY',
      'Invalid pagination, filters or sort.',
    );
  const result = parsed.data;
  if (
    result.view === 'low_price' &&
    (!result.currency || result.maxPrice === undefined)
  ) {
    throw new AppError(
      400,
      'LOW_PRICE_THRESHOLD_REQUIRED',
      'Low-price selection requires currency and an explicit maxPrice.',
    );
  }
  if (
    result.view === 'top' &&
    !(typeof input === 'object' && input !== null && 'sort' in input)
  )
    result.sort = 'score_desc';
  if (
    (result.minPrice !== undefined ||
      result.maxPrice !== undefined ||
      result.sort.startsWith('price_')) &&
    !result.currency
  ) {
    throw new AppError(
      400,
      'CURRENCY_REQUIRED',
      'Price ranges and price sorting require a single currency.',
    );
  }
  return result;
}
export function parseId(input: unknown): string {
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success)
    throw new AppError(400, 'INVALID_ID', 'Identifier must be a UUID.');
  return parsed.data;
}
