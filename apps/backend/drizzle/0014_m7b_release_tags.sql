CREATE TABLE "application_config_version_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_release_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"config_fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"expires_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "application_config_versions_id_application_id_uniq" ON "application_config_versions" USING btree ("id","application_id");--> statement-breakpoint
ALTER TABLE "application_config_version_tags" ADD CONSTRAINT "application_config_version_tags_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_config_version_tags" ADD CONSTRAINT "acvt_version_owner_fk" FOREIGN KEY ("config_version_id","application_id") REFERENCES "public"."application_config_versions"("id","application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_release_checks" ADD CONSTRAINT "application_release_checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_release_checks" ADD CONSTRAINT "application_release_checks_config_version_id_application_config_versions_id_fk" FOREIGN KEY ("config_version_id") REFERENCES "public"."application_config_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acvt_application_id_lower_name_idx" ON "application_config_version_tags" USING btree ("application_id",lower("name"));--> statement-breakpoint
CREATE INDEX "acvt_config_version_id_idx" ON "application_config_version_tags" USING btree ("config_version_id");--> statement-breakpoint
CREATE INDEX "arc_app_ver_created_idx" ON "application_release_checks" USING btree ("application_id","config_version_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "arc_status_created_idx" ON "application_release_checks" USING btree ("status","created_at");
