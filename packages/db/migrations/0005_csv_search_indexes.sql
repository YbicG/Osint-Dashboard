-- Hand-written, mirroring 0001_extensions_and_trgm_indexes.sql: Drizzle Kit
-- 0.30.2 has no first-class support for generated tsvector columns, so this
-- is written directly rather than expressed in packages/db/src/schema/csv-search.ts.
-- pg_trgm is already enabled in 0001; IF NOT EXISTS makes re-declaring it here harmless.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 'simple' (not 'english'): csv_record.search_text is names/SSNs/addresses/
-- identifiers, not prose — English stemming would merge or drop tokens in
-- ways that hurt exact-identifier recall (e.g. collapsing "Johnson"/"Johns").
ALTER TABLE "csv_record"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "search_text")) STORED;

-- Primary search path: ranked full-text match on whole tokens (names,
-- addresses, multi-word queries). See apps/web/src/app/api/csv-search/route.ts.
CREATE INDEX IF NOT EXISTS csv_record_search_vector_idx
  ON "csv_record" USING gin ("search_vector");

-- Fallback/substring path: partial SSNs, phone/zip fragments, and anything
-- tsvector's whole-token model can't match. ILIKE '%x%' is index-accelerated
-- by a trigram GIN index (unlike a plain btree, which a leading wildcard defeats).
CREATE INDEX IF NOT EXISTS csv_record_search_text_trgm_idx
  ON "csv_record" USING gin ("search_text" gin_trgm_ops);
