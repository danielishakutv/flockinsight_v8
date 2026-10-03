ALTER TABLE "meeting" ADD COLUMN "repeat" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "repeat_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "repeat_anchor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "occurrence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "missed_runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "meeting_series_idx" ON "meeting" USING btree ("series_id","status");