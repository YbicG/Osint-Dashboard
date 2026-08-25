ALTER TYPE "public"."source_category" ADD VALUE 'internal';--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "match_key" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_type_match_key_uidx" ON "entity" USING btree ("type","match_key") WHERE "entity"."match_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq_uidx" ON "audit_log" USING btree ("seq");