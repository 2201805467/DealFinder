import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

const weight = z.number().int().min(0).max(100);
const rulesSchema = z
  .object({
    discountWeight: weight.default(35),
    freshnessWeight: weight.default(25),
    availabilityWeight: weight.default(20),
    qualityWeight: weight.default(10),
    shippingWeight: weight.default(10),
    discountCap: z.number().min(1).max(100).default(50),
    topThreshold: z.number().min(1).max(100).default(65),
  })
  .strict()
  .refine(
    (v) =>
      v.discountWeight +
        v.freshnessWeight +
        v.availabilityWeight +
        v.qualityWeight +
        v.shippingWeight ===
      100,
  );
export type ScoringRules = z.infer<typeof rulesSchema>;
export const defaultScoringRules = rulesSchema.parse({});
export function parseScoringRules(json?: string): ScoringRules {
  try {
    return rulesSchema.parse(json ? JSON.parse(json) : {});
  } catch {
    throw new Error('Invalid DEAL_SCORING_RULES: weights must total 100.');
  }
}
type Amount = Prisma.Decimal | string | null;
export interface ScoreInput {
  currentPrice: Amount;
  referencePrice: Amount;
  referencePriceTrusted: boolean;
  currency: string;
  availability: string;
  lastUpdatedAt: Date;
  staleAt: Date | null;
  expiresAt: Date | null;
  shippingCost: Amount;
  productUrl: string | null;
  imageUrl: string | null;
}
const decimal = (value: Amount) =>
  value === null ? null : new Prisma.Decimal(value);

export function evaluateDeal(
  input: ScoreInput,
  now = new Date(),
  rules = defaultScoringRules,
) {
  const current = decimal(input.currentPrice);
  const reference = decimal(input.referencePrice);
  const shipping = decimal(input.shippingCost);
  const isStale = !input.staleAt || input.staleAt <= now;
  const priceValid =
    current !== null &&
    current.isFinite() &&
    current.gte(0) &&
    /^[A-Z]{3}$/.test(input.currency);
  const discounted =
    priceValid &&
    input.referencePriceTrusted &&
    reference !== null &&
    reference.isFinite() &&
    reference.gt(0) &&
    reference.gt(current!);
  const expired = input.expiresAt !== null && input.expiresAt <= now;
  const eligible =
    priceValid && !expired && !isStale && input.availability !== 'UNAVAILABLE';
  const percent = discounted
    ? reference!.minus(current!).div(reference!).mul(100)
    : new Prisma.Decimal(0);
  const age = Math.max(0, now.getTime() - input.lastUpdatedAt.getTime());
  const window = Math.max(
    1,
    (input.staleAt?.getTime() ?? 0) - input.lastUpdatedAt.getTime(),
  );
  const freshnessFraction = new Prisma.Decimal(1)
    .minus(new Prisma.Decimal(age).div(window))
    .clamp(0, 1);
  const parts = {
    discount: Prisma.Decimal.min(percent, rules.discountCap)
      .div(rules.discountCap)
      .mul(rules.discountWeight),
    freshness: freshnessFraction.mul(rules.freshnessWeight),
    availability: new Prisma.Decimal(
      input.availability === 'AVAILABLE' ? rules.availabilityWeight : 0,
    ),
    quality: new Prisma.Decimal(
      (input.productUrl ? 1 : 0) + (input.imageUrl ? 1 : 0),
    )
      .div(2)
      .mul(rules.qualityWeight),
    shipping:
      shipping !== null && shipping.isFinite() && shipping.gte(0) && priceValid
        ? (current!.eq(0)
            ? new Prisma.Decimal(shipping.eq(0) ? 1 : 0)
            : new Prisma.Decimal(1).minus(shipping.div(current!)).clamp(0, 1)
          ).mul(rules.shippingWeight)
        : new Prisma.Decimal(0),
  };
  const score = eligible
    ? Object.values(parts)
        .reduce((a, b) => a.plus(b), new Prisma.Decimal(0))
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : new Prisma.Decimal(0);
  return {
    score: score.toFixed(2),
    isStale,
    referencePriceTrusted: input.referencePriceTrusted,
    classification: !eligible
      ? 'INELIGIBLE'
      : discounted &&
          score.gte(rules.topThreshold) &&
          input.availability === 'AVAILABLE'
        ? 'TOP_DEAL'
        : discounted
          ? 'DISCOUNTED_PRODUCT'
          : 'PRODUCT',
    components: Object.fromEntries(
      Object.entries(parts).map(([key, amount]) => [
        key,
        eligible ? amount.toDecimalPlaces(4).toFixed() : '0',
      ]),
    ),
    reasons: [
      !priceValid && 'INVALID_PRICE',
      expired && 'EXPIRED',
      isStale && 'STALE',
      input.availability === 'UNAVAILABLE' && 'UNAVAILABLE',
      !input.referencePriceTrusted && 'UNTRUSTED_REFERENCE',
      shipping === null && 'SHIPPING_UNKNOWN',
    ].filter(Boolean),
  };
}

// Same rules in PostgreSQL numeric arithmetic for ranking BEFORE pagination.
// The only table aliases are fixed here, never supplied by API clients.
export function dealScoreSql(now: Date, r = defaultScoringRules): Prisma.Sql {
  return Prisma.sql`CASE WHEN o.current_price IS NULL OR o.currency !~ '^[A-Z]{3}$'
    OR o.availability = 'UNAVAILABLE' OR o.stale_at IS NULL OR o.stale_at <= ${now}
    OR (o.expires_at IS NOT NULL AND o.expires_at <= ${now}) THEN 0::numeric ELSE round(
    (CASE WHEN o.reference_price_trusted AND o.reference_price > o.current_price AND o.reference_price > 0
      THEN LEAST((o.reference_price-o.current_price)/o.reference_price*100, ${r.discountCap}::numeric)/${r.discountCap}::numeric*${r.discountWeight} ELSE 0 END)
    + GREATEST(0::numeric, LEAST(1::numeric, 1 - GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz-o.last_updated_at))) /
      GREATEST(0.001, EXTRACT(EPOCH FROM (o.stale_at-o.last_updated_at))))) * ${r.freshnessWeight}
    + CASE WHEN o.availability='AVAILABLE' THEN ${r.availabilityWeight} ELSE 0 END
    + ((CASE WHEN o.product_url IS NOT NULL THEN 1 ELSE 0 END)+(CASE WHEN p.image_url IS NOT NULL THEN 1 ELSE 0 END))::numeric/2*${r.qualityWeight}
    + CASE WHEN o.shipping_cost IS NULL THEN 0 WHEN o.current_price=0 THEN CASE WHEN o.shipping_cost=0 THEN ${r.shippingWeight} ELSE 0 END
      ELSE GREATEST(0::numeric, LEAST(1::numeric, 1-o.shipping_cost/o.current_price))*${r.shippingWeight} END, 2) END`;
}
