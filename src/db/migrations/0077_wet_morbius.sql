ALTER TABLE "church" ADD COLUMN "activation_nudge_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_campaign" ADD COLUMN "purpose" text;