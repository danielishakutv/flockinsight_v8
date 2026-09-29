-- A daily record of what the platform was worth and how big it was.
--
-- MRR has never been written down, so `getOverviewStats` reports it with no
-- delta and says why. It cannot be reconstructed from payments later: a payment
-- says what one church paid on one day, not what everybody was subscribed to
-- that morning, and it cannot see who lapsed. The only way to have history is
-- to start keeping it.
CREATE TABLE IF NOT EXISTS "platform_mrr_snapshot" (
	"day" date PRIMARY KEY NOT NULL,
	"mrr" integer DEFAULT 0 NOT NULL,
	"active_churches" integer DEFAULT 0 NOT NULL,
	"total_churches" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Repeats of 0075, guarded.
--
-- 0075 was written by hand and the drizzle meta snapshot was never updated to
-- match, so the generator believed these columns did not exist and emitted them
-- again — unguarded, which would have aborted the migration on every database
-- that already has them, i.e. all of them. Keeping them with IF NOT EXISTS
-- leaves the generated snapshot honest for the next `drizzle-kit generate`
-- without re-breaking a live deploy.
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "youth_male_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "youth_female_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "senior_male_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "senior_female_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN IF NOT EXISTS "attendance_bands" jsonb;
