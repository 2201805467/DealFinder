-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('BESTBUY', 'WOOCOMMERCE', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "website_url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "storage_authorized" BOOLEAN NOT NULL DEFAULT false,
    "authorization_reference" TEXT,
    "retention_seconds" INTEGER,
    "allow_indefinite_retention" BOOLEAN NOT NULL DEFAULT false,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parent_id" UUID,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "image_url" TEXT,
    "content_merchant_id" UUID NOT NULL,
    "content_external_id" TEXT NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "external_product_id" TEXT NOT NULL,
    "variant_key" TEXT NOT NULL DEFAULT '',
    "market" TEXT NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL DEFAULT '',
    "current_price" DECIMAL(24,6),
    "reference_price" DECIMAL(24,6),
    "discount_percentage" DECIMAL(7,4),
    "product_url" TEXT,
    "affiliate_url" TEXT,
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
    "last_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "error_code" TEXT,
    "error_details" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_website_url_key" ON "merchants"("website_url");

-- CreateIndex
CREATE INDEX "merchants_source_type_enabled_idx" ON "merchants"("source_type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "products_category_id_created_at_idx" ON "products"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "products_expires_at_idx" ON "products"("expires_at");

-- CreateIndex
CREATE INDEX "products_content_merchant_id_idx" ON "products"("content_merchant_id");

-- CreateIndex
CREATE INDEX "offers_product_id_idx" ON "offers"("product_id");

-- CreateIndex
CREATE INDEX "offers_currency_current_price_idx" ON "offers"("currency", "current_price");

-- CreateIndex
CREATE INDEX "offers_market_merchant_id_idx" ON "offers"("market", "merchant_id");

-- CreateIndex
CREATE INDEX "offers_discount_percentage_last_updated_at_idx" ON "offers"("discount_percentage", "last_updated_at");

-- CreateIndex
CREATE INDEX "offers_last_updated_at_idx" ON "offers"("last_updated_at");

-- CreateIndex
CREATE INDEX "offers_expires_at_idx" ON "offers"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "offers_merchant_id_external_product_id_market_variant_key_c_key" ON "offers"("merchant_id", "external_product_id", "market", "variant_key", "currency");

-- CreateIndex
CREATE INDEX "sync_runs_merchant_id_started_at_idx" ON "sync_runs"("merchant_id", "started_at");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_content_merchant_id_fkey" FOREIGN KEY ("content_merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce precision/identity and retention invariants even for direct SQL writes.
ALTER TABLE "merchants" ADD CONSTRAINT "merchant_retention_positive"
  CHECK ("retention_seconds" IS NULL OR "retention_seconds" > 0);
ALTER TABLE "merchants" ADD CONSTRAINT "merchant_authorized_policy"
  CHECK (NOT "storage_authorized" OR
    (("retention_seconds" IS NOT NULL OR "allow_indefinite_retention") AND
    ("is_synthetic" OR length(trim(coalesce("authorization_reference", ''))) > 0)));
ALTER TABLE "merchants" ADD CONSTRAINT "synthetic_source_label"
  CHECK ("source_type" <> 'SYNTHETIC' OR "is_synthetic");
ALTER TABLE "categories" ADD CONSTRAINT "category_not_own_parent" CHECK ("parent_id" IS DISTINCT FROM "id");
ALTER TABLE "offers" ADD CONSTRAINT "offer_amounts_valid" CHECK (
  ("current_price" IS NULL OR "current_price" >= 0) AND
  ("reference_price" IS NULL OR "reference_price" >= 0) AND
  ("current_price" IS NULL OR "reference_price" IS NULL OR "reference_price" >= "current_price") AND
  ("discount_percentage" IS NULL OR ("discount_percentage" >= 0 AND "discount_percentage" <= 100)));
ALTER TABLE "offers" ADD CONSTRAINT "offer_currency_valid" CHECK (
  ("currency" = '' AND "current_price" IS NULL AND "reference_price" IS NULL) OR "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "offers" ADD CONSTRAINT "offer_market_valid" CHECK ("market" = '' OR "market" ~ '^[A-Z]{2}$');
ALTER TABLE "offers" ADD CONSTRAINT "offer_expiry_after_retrieval" CHECK ("expires_at" IS NULL OR "expires_at" > "last_updated_at");
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_count_nonnegative" CHECK ("processed_count" >= 0);
CREATE INDEX "products_name_lower_idx" ON "products" (lower("name") text_pattern_ops);
