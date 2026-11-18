-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyncStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "SyncStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "next_sync_at" TIMESTAMPTZ(3),
ADD COLUMN     "stale_after_seconds" INTEGER NOT NULL DEFAULT 7200,
ADD COLUMN     "sync_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sync_interval_seconds" INTEGER NOT NULL DEFAULT 3600;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "reference_price_trusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shipping_cost" DECIMAL(24,6),
ADD COLUMN     "stale_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "page_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "request_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'BATCH',
ADD COLUMN     "skipped_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill only controlled synthetic fixtures. Never infer commercial reference trust.
UPDATE "offers" SET "reference_price_trusted" = "is_synthetic";
UPDATE "offers" SET "discount_percentage" = NULL WHERE NOT "reference_price_trusted";
UPDATE "offers" o SET "stale_at" = o."last_updated_at" + make_interval(secs => m."stale_after_seconds")
  FROM "merchants" m WHERE m.id = o."merchant_id";

ALTER TABLE "merchants" ADD CONSTRAINT "merchant_sync_intervals_positive"
  CHECK ("sync_interval_seconds" > 0 AND "stale_after_seconds" > 0);
ALTER TABLE "offers" ADD CONSTRAINT "shipping_cost_nonnegative" CHECK ("shipping_cost" IS NULL OR "shipping_cost" >= 0);
ALTER TABLE "offers" ADD CONSTRAINT "stale_after_retrieval" CHECK ("stale_at" IS NULL OR "stale_at" > "last_updated_at");
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_metrics_valid"
  CHECK ("scope" IN ('BATCH', 'SYNCHRONIZATION') AND "page_count" >= 0 AND "request_count" >= 0 AND "skipped_count" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" >= 0));
CREATE INDEX "merchants_sync_enabled_next_sync_at_idx" ON "merchants"("sync_enabled", "next_sync_at");
CREATE INDEX "offers_stale_at_idx" ON "offers"("stale_at");
