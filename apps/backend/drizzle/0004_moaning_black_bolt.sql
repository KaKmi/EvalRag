ALTER TABLE "model_providers" ADD COLUMN "protocol" text NOT NULL;--> statement-breakpoint
ALTER TABLE "model_providers" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;