ALTER TABLE "model_providers" ADD COLUMN "protocol" text;--> statement-breakpoint
UPDATE "model_providers" SET "protocol" = CASE WHEN "type" = 'llm' THEN 'openai_compat' ELSE 'self_hosted' END WHERE "protocol" IS NULL;--> statement-breakpoint
ALTER TABLE "model_providers" ALTER COLUMN "protocol" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "model_providers" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;
