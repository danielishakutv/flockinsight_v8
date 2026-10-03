ALTER TABLE "church" ADD COLUMN "payment_waived_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "waiver_reminder_stage" integer DEFAULT 0 NOT NULL;