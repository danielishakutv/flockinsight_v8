CREATE TABLE "sms_sender_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_key" text NOT NULL,
	"sender_id" text NOT NULL,
	"church_id" text,
	"state" text DEFAULT 'submitting' NOT NULL,
	"error" text,
	"submitted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"last_status" text,
	"last_checked_at" timestamp with time zone,
	CONSTRAINT "sms_sender_submission_senderKey_unique" UNIQUE("sender_key")
);
--> statement-breakpoint
ALTER TABLE "sms_sender_submission" ADD CONSTRAINT "sms_sender_submission_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_sender_submission" ADD CONSTRAINT "sms_sender_submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_sender_submission_church_idx" ON "sms_sender_submission" USING btree ("church_id");--> statement-breakpoint
-- Backfill: sender IDs that are already registered on the network, so the very
-- first submit after this ships can't re-send one of them. State "exists"
-- means "the network has it, we didn't necessarily send it" — if the network
-- later tells us it has no such ID, a submit is still allowed.
INSERT INTO "sms_sender_submission" ("sender_key", "sender_id", "church_id", "state", "last_status")
SELECT lower(replace("sms_sender_id", ' ', '')), "sms_sender_id", "id", 'exists', "sms_sender_status"
FROM "church"
WHERE "sms_sender_id" IS NOT NULL
  AND (
    "sms_sender_status" IN ('approved', 'revoked')
    OR ("sms_sender_status" = 'pending' AND "sms_sender_stage" = 'submitted')
  )
ON CONFLICT ("sender_key") DO NOTHING;