DROP INDEX "first_timer_run_unique";--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD COLUMN "channel" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD COLUMN "outcome" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "first_timer_run_member_idx" ON "first_timer_run" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "first_timer_run_unique" ON "first_timer_run" USING btree ("member_id","stage","channel");