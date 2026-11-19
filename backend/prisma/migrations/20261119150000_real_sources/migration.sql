-- Additive: retain existing merchants/offers and their identities.
ALTER TYPE "SourceType" ADD VALUE 'CHEAPSHARK';
ALTER TYPE "SourceType" ADD VALUE 'GAMERPOWER';
ALTER TABLE merchants ALTER COLUMN website_url DROP NOT NULL;
ALTER TABLE merchants ADD COLUMN is_data_source boolean NOT NULL DEFAULT false,
  ADD COLUMN data_source_id uuid,
  ADD COLUMN external_store_id text;
ALTER TABLE merchants ADD CONSTRAINT merchants_data_source_id_fkey
  FOREIGN KEY (data_source_id) REFERENCES merchants(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX merchants_data_source_id_external_store_id_key ON merchants(data_source_id, external_store_id);
ALTER TABLE offers ADD COLUMN source_metadata jsonb;
