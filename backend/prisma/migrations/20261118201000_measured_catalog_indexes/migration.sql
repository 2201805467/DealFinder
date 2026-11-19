-- Measured on 100k QA rows: newest ID selection 35.917ms -> 0.269ms;
-- substring name search 35.576ms -> 9.099ms. Evidence in docs/qa-evidence.
CREATE INDEX "offers_currency_recent_idx" ON "offers"("currency", "last_updated_at" DESC, "id");
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN (lower("name") gin_trgm_ops);
