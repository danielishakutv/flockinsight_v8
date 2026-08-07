CREATE TYPE "public"."delivery_status" AS ENUM('skipped', 'failed', 'sent', 'delivered', 'undelivered');--> statement-breakpoint
CREATE TABLE "communication_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"log_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"member_id" uuid,
	"name" text,
	"destination" text,
	"status" "delivery_status" NOT NULL,
	"error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "skipped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "communication_recipient" ADD CONSTRAINT "communication_recipient_log_id_communication_log_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."communication_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_recipient" ADD CONSTRAINT "communication_recipient_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_recipient" ADD CONSTRAINT "communication_recipient_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comm_recipient_log_idx" ON "communication_recipient" USING btree ("log_id");--> statement-breakpoint
CREATE INDEX "comm_recipient_church_idx" ON "communication_recipient" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "comm_recipient_member_idx" ON "communication_recipient" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "comm_recipient_status_idx" ON "communication_recipient" USING btree ("status");