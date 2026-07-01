ALTER TABLE "church" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "payment_waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "trial_reminder_stage" integer DEFAULT 0 NOT NULL;