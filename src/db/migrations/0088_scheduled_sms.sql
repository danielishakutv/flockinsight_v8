CREATE TABLE "scheduled_sms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"audience" text NOT NULL,
	"body" text NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'communication' NOT NULL,
	"reason" text,
	"send_after" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"log_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_sms_due_idx" ON "scheduled_sms" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "scheduled_sms_church_idx" ON "scheduled_sms" USING btree ("church_id","status");