CREATE TABLE "resolution_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_a_id" uuid NOT NULL,
	"entity_b_id" uuid NOT NULL,
	"score" real NOT NULL,
	"matched_on" text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"first_flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "resolution_candidate" ADD CONSTRAINT "resolution_candidate_entity_a_id_entity_id_fk" FOREIGN KEY ("entity_a_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_candidate" ADD CONSTRAINT "resolution_candidate_entity_b_id_entity_id_fk" FOREIGN KEY ("entity_b_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_candidate" ADD CONSTRAINT "resolution_candidate_reviewed_by_user_id_app_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resolution_candidate_status_idx" ON "resolution_candidate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "resolution_candidate_entity_a_idx" ON "resolution_candidate" USING btree ("entity_a_id");--> statement-breakpoint
CREATE INDEX "resolution_candidate_entity_b_idx" ON "resolution_candidate" USING btree ("entity_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_candidate_pair_idx" ON "resolution_candidate" USING btree ("entity_a_id","entity_b_id");