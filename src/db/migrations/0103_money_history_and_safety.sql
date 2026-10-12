ALTER TYPE "public"."partner_earning_kind" ADD VALUE 'reversal';--> statement-breakpoint
CREATE TABLE "media_orphan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text,
	"public_id" text NOT NULL,
	"resource_type" text DEFAULT 'image' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_tried_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_upload_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"public_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_earning" DROP CONSTRAINT "partner_earning_partner_id_partner_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_payout" DROP CONSTRAINT "partner_payout_partner_id_partner_id_fk";
--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_church_id_church_id_fk";
--> statement-breakpoint
DROP INDEX "celebration_run_unique";--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "church_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "celebration_run" ADD COLUMN "channel" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "celebration_run" ADD COLUMN "outcome" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "celebration_run" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "celebration_run" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "celebration_run" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "transcode_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "transcode_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "transcode_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_recording" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_recording" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "church_name" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "surcharge_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "extends_plan" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_sms" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "wallet_txn" ADD COLUMN "reference" text;--> statement-breakpoint
CREATE UNIQUE INDEX "media_orphan_public_id_idx" ON "media_orphan" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_upload_ticket_public_id_idx" ON "media_upload_ticket" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "media_upload_ticket_open_idx" ON "media_upload_ticket" USING btree ("church_id","status","expires_at");--> statement-breakpoint
ALTER TABLE "partner_earning" ADD CONSTRAINT "partner_earning_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout" ADD CONSTRAINT "partner_payout_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "celebration_run_channel_unique" ON "celebration_run" USING btree ("member_id","kind","on_date","channel");--> statement-breakpoint
CREATE INDEX "celebration_run_church_date_idx" ON "celebration_run" USING btree ("church_id","on_date");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_txn_giving_uidx" ON "finance_transaction" USING btree ("giving_id") WHERE "finance_transaction"."giving_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_txn_reference_idx" ON "wallet_txn" USING btree ("reference") WHERE "wallet_txn"."reference" is not null;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_requestId_unique" UNIQUE("request_id");--> statement-breakpoint
ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_requestId_unique" UNIQUE("request_id");--> statement-breakpoint
ALTER TABLE "partner_earning" ADD CONSTRAINT "partner_earning_sign_chk" CHECK (("partner_earning"."kind"::text = 'reversal') = ("partner_earning"."amount" < 0));--> statement-breakpoint
-- Hand-written below this line: what drizzle cannot express.
--
-- Every payment carries the name of the church that paid, so a payment whose
-- church is later deleted (church_id SET NULL above) still says whose it was.
-- New deletes stamp it as they happen; this fills in every payment that exists.
UPDATE "payment" AS p SET "church_name" = c."name"
FROM "church" AS c
WHERE c."id" = p."church_id" AND p."church_name" IS NULL;--> statement-breakpoint
-- The database's own refusal of a double booking: two APPROVED bookings of
-- one facility may not overlap. Half-open, so one may start exactly when the
-- other ends. lockFacilityForBooking is the application's half; this is the
-- floor under any write path that forgets it. isBookingOverlapViolation reads
-- its SQLSTATE 23P01. See facilities.db-check.ts.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_no_overlap"
  EXCLUDE USING gist (
    "facility_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" = 'approved');
