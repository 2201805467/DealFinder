-- Weight-independent, unrounded numeric factors. PostgreSQL regenerates these
-- atomically on EVERY write, including SQL outside the ingestion service.
ALTER TABLE offers
  ADD COLUMN score_discount_percent numeric GENERATED ALWAYS AS (
    CASE WHEN reference_price_trusted AND reference_price > current_price AND reference_price > 0
      THEN (reference_price-current_price)/reference_price*100 ELSE 0::numeric END
  ) STORED,
  ADD COLUMN score_shipping_fraction numeric GENERATED ALWAYS AS (
    CASE WHEN shipping_cost IS NULL OR current_price IS NULL THEN 0::numeric
      WHEN current_price=0 THEN CASE WHEN shipping_cost=0 THEN 1::numeric ELSE 0::numeric END
      ELSE GREATEST(0::numeric,LEAST(1::numeric,1-shipping_cost/current_price)) END
  ) STORED,
  ADD COLUMN score_updated_epoch numeric GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (last_updated_at AT TIME ZONE 'UTC'))
  ) STORED,
  ADD COLUMN score_freshness_seconds numeric GENERATED ALWAYS AS (
    GREATEST(0.001::numeric,EXTRACT(EPOCH FROM (stale_at-last_updated_at)))
  ) STORED;
