-- Additive only: transactionally records the next unprocessed source item.
ALTER TABLE "merchants" ADD COLUMN "sync_checkpoint" JSONB;
