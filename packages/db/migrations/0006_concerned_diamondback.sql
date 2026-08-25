CREATE TABLE "entity_blocking_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"key_kind" text NOT NULL
);
--> statement-breakpoint
-- value_fingerprint is added nullable here rather than NOT NULL: the claim
-- table already has rows by the time this migration runs (dev seed data,
-- and any real deployment), and there is no safe constant/SQL-computable
-- default for it — the real value comes from the predicate-aware
-- computeValueFingerprint() in packages/core/src/monitoring/claim-fingerprint.ts.
-- Sequence for a clean apply: (1) this migration, (2) run
-- `pnpm --filter @osint/worker backfill-claim-value-fingerprint` to populate
-- every existing row via that same TS logic, (3) migration 0007 which sets
-- the column NOT NULL. Running 0007 before the backfill will correctly fail
-- loudly (23502) rather than silently accept a placeholder value.
ALTER TABLE "claim" ADD COLUMN "value_fingerprint" text;--> statement-breakpoint
ALTER TABLE "entity_blocking_key" ADD CONSTRAINT "entity_blocking_key_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_blocking_key_key_idx" ON "entity_blocking_key" USING btree ("key");--> statement-breakpoint
CREATE INDEX "entity_blocking_key_entity_idx" ON "entity_blocking_key" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_blocking_key_entity_key_idx" ON "entity_blocking_key" USING btree ("entity_id","key");--> statement-breakpoint
CREATE INDEX "claim_fingerprint_idx" ON "claim" USING btree ("subject_entity_id","predicate","value_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_triple_uidx" ON "edge" USING btree ("type","source_entity_id","target_entity_id");