CREATE TABLE "eval_candidate_ledger" (
	"target_trace_id" varchar(32) NOT NULL,
	"judge_version" varchar(100) NOT NULL,
	"worker_name" varchar(100) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"trace_start_time" timestamp with time zone NOT NULL,
	"agent_id" varchar(64) DEFAULT '' NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_error" text,
	CONSTRAINT "eval_candidate_ledger_target_trace_id_judge_version_pk" PRIMARY KEY("target_trace_id","judge_version")
);
--> statement-breakpoint
ALTER TABLE "eval_watermarks" ADD COLUMN "last_cursor_move_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "eval_candidate_ledger_trace_start_time_idx" ON "eval_candidate_ledger" USING btree ("trace_start_time");