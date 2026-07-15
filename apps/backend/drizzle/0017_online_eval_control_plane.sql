CREATE TABLE "eval_watermarks" (
	"worker_name" varchar(100) PRIMARY KEY NOT NULL,
	"last_ts" timestamp with time zone NOT NULL,
	"last_trace_id" varchar(32) DEFAULT '' NOT NULL,
	"daily_date" date NOT NULL,
	"daily_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(200),
	"lease_until" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_eval_settings" (
	"id" varchar(64) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sample_rate" numeric(5, 4) DEFAULT 0.1 NOT NULL,
	"judge_model_id" uuid,
	"embedding_model_id" uuid,
	"faithfulness_threshold" smallint DEFAULT 85 NOT NULL,
	"answer_relevancy_threshold" smallint DEFAULT 80 NOT NULL,
	"context_precision_threshold" smallint DEFAULT 80 NOT NULL,
	"daily_cap" integer DEFAULT 500 NOT NULL,
	"judge_version" varchar(100) DEFAULT 'online-v1' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_eval_settings_sample_rate_check" CHECK ("online_eval_settings"."sample_rate" BETWEEN 0 AND 1),
	CONSTRAINT "online_eval_settings_faithfulness_threshold_check" CHECK ("online_eval_settings"."faithfulness_threshold" BETWEEN 0 AND 100),
	CONSTRAINT "online_eval_settings_answer_relevancy_threshold_check" CHECK ("online_eval_settings"."answer_relevancy_threshold" BETWEEN 0 AND 100),
	CONSTRAINT "online_eval_settings_context_precision_threshold_check" CHECK ("online_eval_settings"."context_precision_threshold" BETWEEN 0 AND 100),
	CONSTRAINT "online_eval_settings_daily_cap_check" CHECK ("online_eval_settings"."daily_cap" BETWEEN 1 AND 10000)
);
