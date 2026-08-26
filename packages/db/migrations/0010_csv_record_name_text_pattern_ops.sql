-- Hand-written, and NOT run via `pnpm db:migrate` -- see the warning below.
--
-- Rebuilds csv_record_last_name_idx/csv_record_first_name_idx using the
-- text_pattern_ops operator class instead of the default btree opclass.
--
-- Why: apps/web/src/app/api/csv-search/route.ts's name search does
-- `WHERE last_name LIKE 'smith%'` (a prefix match). A plain btree index can
-- only serve that as an index scan when the column's collation is `C` --
-- this database was initialized under the official Postgres image's default
-- (en_US.utf8), so the existing plain-btree indexes on last_name/first_name
-- have never actually been usable for that query, and every name search has
-- been falling back to a full sequential scan of csv_record regardless of
-- the index existing. text_pattern_ops indexes serve LIKE-prefix scans
-- correctly under any collation, and still serve plain `=` equality just as
-- well (equality doesn't depend on sort order), so this is a strict
-- improvement with no other behavior change.
--
-- WARNING -- do not run this through `pnpm db:migrate`: drizzle-orm wraps
-- an entire migration file in one transaction (see
-- postgres-js/migrator.cjs -> PgDialect.migrate), and CREATE/DROP INDEX
-- CONCURRENTLY cannot run inside a transaction block (same class of error
-- as infra/scripts/tune-for-bulk-load.ps1's ALTER SYSTEM statements -- see
-- docs/RUNBOOK.md's "Schema migrations" section). CONCURRENTLY is used
-- deliberately here rather than the tuning script's drop-all/rebuild-all
-- approach, because unlike a bulk load this runs against a table search
-- traffic may be live against -- a plain (non-concurrent) CREATE INDEX
-- takes a lock that blocks writers for the whole build, which is
-- unnecessary here since csv_record isn't being written to during this
-- operation.
--
-- Run each statement by hand instead, e.g.:
--   docker exec -it osint-dashboard-postgres-1 psql -U osint -d osint -c "<statement>"
-- one at a time, in order. At ~1.12B rows this will take real time --
-- expect each CREATE INDEX CONCURRENTLY to be in the same ballpark as the
-- original csv_record_last_name_idx/csv_record_first_name_idx builds (see
-- docs/RUNBOOK.md's bulk-load section) -- poll progress the same way, via
-- pg_stat_progress_create_index.

DROP INDEX CONCURRENTLY IF EXISTS "csv_record_last_name_idx";
DROP INDEX CONCURRENTLY IF EXISTS "csv_record_first_name_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "csv_record_last_name_idx" ON "csv_record" USING btree ("last_name" text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "csv_record_first_name_idx" ON "csv_record" USING btree ("first_name" text_pattern_ops);

ANALYZE "csv_record";
