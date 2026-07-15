ALTER TABLE "messages" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_conv_id_sequence_idx" ON "messages" USING btree ("conv_id","sequence");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sequence_unique" UNIQUE("sequence");