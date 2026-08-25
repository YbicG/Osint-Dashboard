CREATE TYPE "public"."csv_file_status" AS ENUM('discovered', 'queued', 'indexing', 'indexed', 'error', 'removed');--> statement-breakpoint
CREATE TYPE "public"."csv_folder_scan_status" AS ENUM('idle', 'scanning', 'error');--> statement-breakpoint
CREATE TABLE "csv_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csv_source_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"absolute_path" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"file_mtime_ms" timestamp with time zone NOT NULL,
	"status" "csv_file_status" DEFAULT 'discovered' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_row_count" integer DEFAULT 0 NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sensitive_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delimiter" text DEFAULT ',' NOT NULL,
	"error_message" text,
	"indexed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csv_source_folder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"label" text NOT NULL,
	"recursive" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scan_at" timestamp with time zone,
	"last_scan_status" "csv_folder_scan_status" DEFAULT 'idle' NOT NULL,
	"last_scan_error" text,
	CONSTRAINT "csv_source_folder_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "csv_record" ADD CONSTRAINT "csv_record_file_id_csv_source_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."csv_source_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_record" ADD CONSTRAINT "csv_record_folder_id_csv_source_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."csv_source_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_source_file" ADD CONSTRAINT "csv_source_file_folder_id_csv_source_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."csv_source_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_source_folder" ADD CONSTRAINT "csv_source_folder_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csv_record_file_idx" ON "csv_record" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "csv_record_folder_idx" ON "csv_record" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "csv_source_file_folder_relpath_uidx" ON "csv_source_file" USING btree ("folder_id","relative_path");--> statement-breakpoint
CREATE INDEX "csv_source_file_folder_idx" ON "csv_source_file" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "csv_source_file_status_idx" ON "csv_source_file" USING btree ("status");