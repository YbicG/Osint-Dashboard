-- Extensions required by the OSINT platform schema.
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: face/text embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy/trigram name & address matching
CREATE EXTENSION IF NOT EXISTS unaccent;    -- accent-insensitive name normalization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- uuid generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid, digest() for hash-chained audit log
