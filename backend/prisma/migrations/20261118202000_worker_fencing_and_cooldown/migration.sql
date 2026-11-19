-- Fencing survives loss of the advisory-lock connection; cooldown survives Worker restarts.
ALTER TABLE "merchants" ADD COLUMN "sync_generation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "merchants" ADD COLUMN "sync_not_before" TIMESTAMPTZ(3);
