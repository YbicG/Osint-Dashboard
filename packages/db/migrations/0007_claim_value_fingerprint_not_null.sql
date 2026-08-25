-- Locks down claim.value_fingerprint, added nullable in 0006 so existing
-- rows wouldn't block that migration. Run
-- `pnpm --filter @osint/worker backfill-claim-value-fingerprint` BEFORE
-- applying this migration — if any row is still NULL, this correctly fails
-- loudly (23502) rather than silently coercing a placeholder value.
ALTER TABLE "claim" ALTER COLUMN "value_fingerprint" SET NOT NULL;
