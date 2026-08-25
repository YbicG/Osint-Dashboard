-- Hand-written (see packages/db/src/schema/search.ts's doc comments and
-- docs/PLAN.md's M3 "Pivot engine" section): adds the pivot-tree provenance
-- columns to search_request. Uses `--custom` rather than `drizzle-kit
-- generate` because the csv_record snapshot has been out of sync with
-- schema.ts since 0008 (also hand-written, for the same reason: a plain
-- `generate` against schema.ts as it stands today would additionally try
-- to re-diff csv_record's already-applied lookup-column migration).
--
-- derived_from_claim_id is deliberately NOT a DB-level foreign key to
-- claim.id -- see the long comment on that column in search.ts explaining
-- the search -> claim -> source -> search import cycle a real FK would
-- create. Enforced at the application layer instead.
ALTER TABLE "search_request"
  ADD COLUMN "parent_search_id" uuid,
  ADD COLUMN "root_search_id" uuid,
  ADD COLUMN "pivot_depth" integer NOT NULL DEFAULT 0,
  ADD COLUMN "origin" text NOT NULL DEFAULT 'user',
  ADD COLUMN "derived_from_claim_id" uuid,
  ADD COLUMN "connector_budget" integer NOT NULL DEFAULT 120,
  ADD COLUMN "connector_budget_used" integer NOT NULL DEFAULT 0;

ALTER TABLE "search_request"
  ADD CONSTRAINT "search_request_parent_search_id_search_request_id_fk"
    FOREIGN KEY ("parent_search_id") REFERENCES "search_request"("id"),
  ADD CONSTRAINT "search_request_root_search_id_search_request_id_fk"
    FOREIGN KEY ("root_search_id") REFERENCES "search_request"("id");

ALTER TABLE "search_request"
  ADD CONSTRAINT "search_request_origin_check"
    CHECK ("origin" IN ('user', 'auto_pivot', 'manual_expand', 'monitoring'));

CREATE INDEX IF NOT EXISTS "search_request_root_idx" ON "search_request" USING btree ("root_search_id");
CREATE INDEX IF NOT EXISTS "search_request_parent_idx" ON "search_request" USING btree ("parent_search_id");
