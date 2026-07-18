DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM eval_runs WHERE status IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'eval w2b migration blocked: queued or running eval_runs exist';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "eval_case_versions" ADD COLUMN "gold_doc_refs" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE eval_case_versions v SET gold_doc_refs = COALESCE(
  (SELECT jsonb_agg(jsonb_build_object('docId', d.id_text, 'chunkId', NULL,
      'docName', COALESCE(doc.name, ''), 'section', NULL))
   FROM (SELECT unnest(v.gold_doc_ids)::text AS id_text) d
   LEFT JOIN documents doc ON doc.id::text = d.id_text), '[]'::jsonb)
WHERE cardinality(v.gold_doc_ids) > 0;
--> statement-breakpoint
ALTER TABLE "eval_case_versions" DROP COLUMN "gold_doc_ids";
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "repeat_count" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD COLUMN "repeat_index" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD COLUMN "citation" smallint;
--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD COLUMN "context_recall" smallint;
--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD COLUMN "ndcg5" smallint;
--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD COLUMN "hit_rate5" smallint;
--> statement-breakpoint
ALTER TABLE "eval_run_results" DROP CONSTRAINT "eval_run_results_scores_check";
--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_scores_check" CHECK (
  ("eval_run_results"."faithfulness" IS NULL OR "eval_run_results"."faithfulness" BETWEEN 0 AND 100)
  AND ("eval_run_results"."answer_relevancy" IS NULL OR "eval_run_results"."answer_relevancy" BETWEEN 0 AND 100)
  AND ("eval_run_results"."context_precision" IS NULL OR "eval_run_results"."context_precision" BETWEEN 0 AND 100)
  AND ("eval_run_results"."correctness" IS NULL OR "eval_run_results"."correctness" BETWEEN 0 AND 100)
  AND ("eval_run_results"."citation" IS NULL OR "eval_run_results"."citation" BETWEEN 0 AND 100)
  AND ("eval_run_results"."context_recall" IS NULL OR "eval_run_results"."context_recall" BETWEEN 0 AND 100)
  AND ("eval_run_results"."ndcg5" IS NULL OR "eval_run_results"."ndcg5" BETWEEN 0 AND 100)
  AND ("eval_run_results"."hit_rate5" IS NULL OR "eval_run_results"."hit_rate5" BETWEEN 0 AND 100)
  AND ("eval_run_results"."min_score" IS NULL OR "eval_run_results"."min_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
DROP INDEX "eval_run_results_run_case_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "eval_run_results_run_case_unique" ON "eval_run_results" USING btree ("run_id","case_version_id","repeat_index");
