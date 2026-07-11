CREATE TABLE "prompt_version_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "contract_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "compile_status" text;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "compile_errors" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_prompt_id_id_uniq" ON "prompt_versions" USING btree ("prompt_id","id");--> statement-breakpoint
ALTER TABLE "prompt_version_tags" ADD CONSTRAINT "prompt_version_tags_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_version_tags" ADD CONSTRAINT "prompt_version_tags_version_owner_fk" FOREIGN KEY ("prompt_version_id","prompt_id") REFERENCES "public"."prompt_versions"("id","prompt_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_tags_prompt_id_lower_name_idx" ON "prompt_version_tags" USING btree ("prompt_id",lower("name"));
