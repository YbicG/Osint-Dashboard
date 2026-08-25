-- Hand-written (see packages/db/src/schema/csv-search.ts's doc comment and
-- docs/RUNBOOK.md's "Bulk-loading very large CSV files"): replaces the
-- generic search_text/search_vector(tsvector)/trigram design from
-- 0005_csv_search_indexes.sql with typed, extracted lookup columns +
-- B-tree indexes, sized for a billion-row fixed-schema PII source. Neither
-- search_vector (a generated column) nor the two indexes it and
-- search_text backed were ever tracked in Drizzle's schema.ts (0005 was
-- itself hand-written for the same reason), so they're dropped here by
-- hand rather than via a Drizzle-generated ALTER.
DROP INDEX IF EXISTS csv_record_search_vector_idx;
DROP INDEX IF EXISTS csv_record_search_text_trgm_idx;

ALTER TABLE "csv_record" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "csv_record" DROP COLUMN IF EXISTS "search_text";

ALTER TABLE "csv_record"
  ADD COLUMN "ssn" text,
  ADD COLUMN "first_name" text,
  ADD COLUMN "last_name" text,
  ADD COLUMN "dob" text,
  ADD COLUMN "phone" text,
  ADD COLUMN "zip" text,
  ADD COLUMN "city" text,
  ADD COLUMN "state" text,
  ADD COLUMN "address" text;

-- Plain B-tree: this data's actual query pattern is exact/prefix lookup on
-- a specific field, which B-tree serves natively and far more cheaply
-- (build time, storage, write-time maintenance) than GIN at this row
-- count. Not every new column gets one -- city/state/address are typically
-- used as secondary filters alongside a name/ssn/phone match, not as the
-- primary lookup key, so indexing them wasn't worth the extra write-time
-- cost during bulk load.
CREATE INDEX IF NOT EXISTS "csv_record_ssn_idx" ON "csv_record" USING btree ("ssn");
CREATE INDEX IF NOT EXISTS "csv_record_last_name_idx" ON "csv_record" USING btree ("last_name");
CREATE INDEX IF NOT EXISTS "csv_record_first_name_idx" ON "csv_record" USING btree ("first_name");
CREATE INDEX IF NOT EXISTS "csv_record_phone_idx" ON "csv_record" USING btree ("phone");
CREATE INDEX IF NOT EXISTS "csv_record_zip_idx" ON "csv_record" USING btree ("zip");
CREATE INDEX IF NOT EXISTS "csv_record_dob_idx" ON "csv_record" USING btree ("dob");

-- Trigram GIN survives here, deliberately, ONLY on ssn -- to keep "search
-- by last 4 (or any substring) of an SSN" working, which B-tree can't do.
-- Affordable at this scale specifically because it indexes one small
-- structured column (a handful of digits), not a whole-row text blob like
-- the old search_text trigram index did.
CREATE INDEX IF NOT EXISTS "csv_record_ssn_trgm_idx" ON "csv_record" USING gin ("ssn" gin_trgm_ops);
