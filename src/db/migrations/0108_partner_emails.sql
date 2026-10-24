CREATE TABLE "partner_digest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"segment" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"subject" text,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "status_previous" "partner_status";--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "status_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "digest_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_digest" ADD CONSTRAINT "partner_digest_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_digest_slot_idx" ON "partner_digest" USING btree ("partner_id","slot");--> statement-breakpoint
CREATE INDEX "partner_digest_slot_status_idx" ON "partner_digest" USING btree ("slot","status");