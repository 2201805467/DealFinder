import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../utils/app-error.js';

export function exactMoney(
  value: number | string | undefined,
): Prisma.Decimal | null {
  if (value === undefined) return null;
  if (
    (typeof value === 'number' &&
      (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) ||
    !/^\d+(\.\d{1,6})?$/.test(String(value))
  ) {
    throw new AppError(
      400,
      'INVALID_PRICE',
      'Prices require non-negative decimal amounts with at most six decimal places.',
    );
  }
  const amount = new Prisma.Decimal(String(value));
  if (amount.gte('1000000000000000000'))
    throw new AppError(
      400,
      'INVALID_PRICE',
      'Price exceeds supported precision.',
    );
  return amount;
}

export function calculatedDiscount(
  current: Prisma.Decimal | null,
  reference: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (
    current === null ||
    reference === null ||
    !reference.gt(0) ||
    !reference.gt(current)
  )
    return null;
  return reference
    .minus(current)
    .div(reference)
    .mul(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
