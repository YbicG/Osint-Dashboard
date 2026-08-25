-- Idempotent: safe to run against a fresh Postgres that never saw
-- infra/init/postgres/001-extensions.sql (e.g. a hosted Postgres instance
-- added later), and safe to re-run during `drizzle-kit migrate`.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fuzzy/substring search on entity display labels (universal search bar).
CREATE INDEX IF NOT EXISTS entity_display_label_trgm_idx
  ON "entity" USING gin ("display_label" gin_trgm_ops);

-- Fuzzy alias search (aka/nickname/dba lookups).
CREATE INDEX IF NOT EXISTS entity_alias_alias_trgm_idx
  ON "entity_alias" USING gin ("alias" gin_trgm_ops);

-- ivfflat index for face-embedding cosine similarity search. Built with a
-- modest list count suited to a single-tenant/local deployment; revisit
-- (and REINDEX) once face_embedding rows are in the hundreds of thousands.
CREATE INDEX IF NOT EXISTS face_embedding_cosine_idx
  ON "face_embedding" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
