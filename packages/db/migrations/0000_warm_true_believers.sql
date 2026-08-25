CREATE TYPE "public"."case_status" AS ENUM('open', 'on_hold', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cluster_status" AS ENUM('auto_merged', 'needs_review', 'manually_confirmed', 'manually_split');--> statement-breakpoint
CREATE TYPE "public"."collection_run_status" AS ENUM('pending', 'running', 'hit', 'miss', 'blocked', 'error', 'skipped_captcha');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('relative', 'spouse', 'associate', 'coworker', 'neighbor', 'employee_of', 'owner_of', 'officer_of', 'registered_agent_of', 'resides_at', 'uses_contact', 'uses_username', 'registered_vehicle', 'party_to_case', 'same_as');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('person', 'organization', 'address', 'phone', 'email', 'username', 'vehicle', 'vessel', 'aircraft', 'domain', 'ip_address', 'crypto_wallet', 'court_case', 'image', 'document');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'supervisor', 'analyst', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."source_category" AS ENUM('federal', 'courts_corrections', 'property_assets', 'business_professional', 'digital', 'sanctions_watchlists', 'vital_genealogy', 'consumer_api', 'licensed_vendor');--> statement-breakpoint
CREATE TYPE "public"."source_cost_type" AS ENUM('free', 'freemium', 'paid_api', 'licensed');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "role" DEFAULT 'analyst' NOT NULL,
	"password_hash" text NOT NULL,
	"mfa_secret" text,
	"mfa_enrolled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "org" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entity_type" NOT NULL,
	"display_label" text NOT NULL,
	"cluster_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_type" text NOT NULL,
	"source_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_cluster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "cluster_status" DEFAULT 'needs_review' NOT NULL,
	"cohesion_score" real NOT NULL,
	"primary_entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "merge_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_a_id" uuid NOT NULL,
	"entity_b_id" uuid NOT NULL,
	"action" text NOT NULL,
	"score" real,
	"matched_on" text[],
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"status" "collection_run_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"claims_produced" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"request_archive_sha256" text,
	"response_archive_sha256" text,
	"screenshot_sha256" text
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" text NOT NULL,
	"name" text NOT NULL,
	"category" "source_category" NOT NULL,
	"cost_type" "source_cost_type" NOT NULL,
	"jurisdiction" text,
	"homepage_url" text,
	"tos_url" text,
	"robots_policy" text DEFAULT 'honor' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "source_connector_id_unique" UNIQUE("connector_id")
);
--> statement-breakpoint
CREATE TABLE "search_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"subject_entity_id" uuid,
	"input_type" text NOT NULL,
	"input_payload" jsonb NOT NULL,
	"purpose_code" text NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "case_status" DEFAULT 'open' NOT NULL,
	"purpose_code" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"biometric_data_purged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"entity_id" uuid,
	"label" text NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"monitoring_enabled" boolean DEFAULT false NOT NULL,
	"monitoring_interval_hours" integer
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_entity_id" uuid NOT NULL,
	"object_entity_id" uuid,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"source_id" uuid NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"observed_at" timestamp with time zone,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" real NOT NULL,
	"raw_snippet" text,
	"evidence_url" text,
	"screenshot_sha256" text,
	"retracted_at" timestamp with time zone,
	"retracted_reason" text
);
--> statement-breakpoint
CREATE TABLE "edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "edge_type" NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"label" text,
	"confidence" real NOT NULL,
	"first_observed_at" timestamp with time zone,
	"last_observed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "edge_claim" (
	"edge_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	CONSTRAINT "edge_claim_edge_id_claim_id_pk" PRIMARY KEY("edge_id","claim_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"purpose_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_entry_hash" text,
	"entry_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_entity_id" uuid NOT NULL,
	"source_claim_id" uuid NOT NULL,
	"embedding" vector(512),
	"bounding_box" jsonb NOT NULL,
	"detection_confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_cluster_id_identity_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."identity_cluster"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_alias" ADD CONSTRAINT "entity_alias_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_cluster" ADD CONSTRAINT "identity_cluster_reviewed_by_user_id_app_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decision" ADD CONSTRAINT "merge_decision_entity_a_id_entity_id_fk" FOREIGN KEY ("entity_a_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decision" ADD CONSTRAINT "merge_decision_entity_b_id_entity_id_fk" FOREIGN KEY ("entity_b_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decision" ADD CONSTRAINT "merge_decision_decided_by_user_id_app_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_run" ADD CONSTRAINT "collection_run_search_id_search_request_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."search_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_run" ADD CONSTRAINT "collection_run_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_request" ADD CONSTRAINT "search_request_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_request" ADD CONSTRAINT "search_request_subject_entity_id_entity_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_request" ADD CONSTRAINT "search_request_requested_by_user_id_app_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachment" ADD CONSTRAINT "case_attachment_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachment" ADD CONSTRAINT "case_attachment_uploaded_by_user_id_app_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_note" ADD CONSTRAINT "case_note_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_note" ADD CONSTRAINT "case_note_author_user_id_app_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_added_by_user_id_app_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_subject_entity_id_entity_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_object_entity_id_entity_id_fk" FOREIGN KEY ("object_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_collection_run_id_collection_run_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_source_entity_id_entity_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_target_entity_id_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_claim" ADD CONSTRAINT "edge_claim_edge_id_edge_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_claim" ADD CONSTRAINT "edge_claim_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_embedding" ADD CONSTRAINT "face_embedding_image_entity_id_entity_id_fk" FOREIGN KEY ("image_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_embedding" ADD CONSTRAINT "face_embedding_source_claim_id_claim_id_fk" FOREIGN KEY ("source_claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_type_idx" ON "entity" USING btree ("type");--> statement-breakpoint
CREATE INDEX "entity_cluster_idx" ON "entity" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "entity_alias_entity_idx" ON "entity_alias" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_alias_alias_idx" ON "entity_alias" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "merge_decision_entity_a_idx" ON "merge_decision" USING btree ("entity_a_id");--> statement-breakpoint
CREATE INDEX "merge_decision_entity_b_idx" ON "merge_decision" USING btree ("entity_b_id");--> statement-breakpoint
CREATE INDEX "collection_run_search_idx" ON "collection_run" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "collection_run_status_idx" ON "collection_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "case_org_idx" ON "case" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subject_case_idx" ON "subject" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "claim_subject_idx" ON "claim" USING btree ("subject_entity_id");--> statement-breakpoint
CREATE INDEX "claim_object_idx" ON "claim" USING btree ("object_entity_id");--> statement-breakpoint
CREATE INDEX "claim_predicate_idx" ON "claim" USING btree ("predicate");--> statement-breakpoint
CREATE INDEX "claim_source_idx" ON "claim" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "claim_subject_predicate_idx" ON "claim" USING btree ("subject_entity_id","predicate");--> statement-breakpoint
CREATE INDEX "edge_source_idx" ON "edge" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "edge_target_idx" ON "edge" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "edge_type_idx" ON "edge" USING btree ("type");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "face_embedding_image_idx" ON "face_embedding" USING btree ("image_entity_id");