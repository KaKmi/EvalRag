CREATE TABLE "eval_case_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"question" varchar(500) NOT NULL,
	"gold_points" text[] DEFAULT '{}'::text[] NOT NULL,
	"gold_doc_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"tags" varchar(12)[] DEFAULT '{}'::varchar[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"gold_stale" boolean DEFAULT false NOT NULL,
	"source_trace_id" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "eval_cases_status_check" CHECK ("eval_cases"."status" IN ('draft','reviewed'))
);
--> statement-breakpoint
CREATE TABLE "eval_run_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"verdict" varchar(20) NOT NULL,
	"faithfulness" smallint,
	"answer_relevancy" smallint,
	"context_precision" smallint,
	"correctness" smallint,
	"min_metric" varchar(30),
	"min_score" smallint,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_trace_id" varchar(32),
	"answer" text DEFAULT '' NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_run_results_verdict_check" CHECK ("eval_run_results"."verdict" IN ('pass','weak','low','timeout','unscored'))
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"judge_model_id" uuid NOT NULL,
	"embedding_model_id" uuid NOT NULL,
	"offline_judge_version" varchar(100) DEFAULT 'offline-v1' NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"scope" varchar(20) DEFAULT 'all' NOT NULL,
	"case_version_snapshot" jsonb NOT NULL,
	"total_cases" integer DEFAULT 0 NOT NULL,
	"done_cases" integer DEFAULT 0 NOT NULL,
	"token_budget" integer DEFAULT 500000 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"stop_requested_at" timestamp with time zone,
	"lease_owner" varchar(200),
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_by" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_runs_status_check" CHECK ("eval_runs"."status" IN ('queued','running','done','partial','budget_stop','failed'))
);
--> statement-breakpoint
CREATE TABLE "eval_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kb_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_case_versions" ADD CONSTRAINT "eval_case_versions_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_set_id_eval_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."eval_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_case_version_id_eval_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."eval_case_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_id_eval_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."eval_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_versions_case_version_unique" ON "eval_case_versions" USING btree ("case_id","version");--> statement-breakpoint
CREATE INDEX "eval_cases_set_status_idx" ON "eval_cases" USING btree ("set_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_run_results_run_case_unique" ON "eval_run_results" USING btree ("run_id","case_version_id");--> statement-breakpoint
CREATE INDEX "eval_run_results_worst_idx" ON "eval_run_results" USING btree ("run_id","min_score");--> statement-breakpoint
CREATE INDEX "eval_runs_idempotency_idx" ON "eval_runs" USING btree ("set_id","config_version_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_active_idx" ON "eval_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_sets_name_unique" ON "eval_sets" USING btree (lower("name")) WHERE "eval_sets"."deleted_at" IS NULL;