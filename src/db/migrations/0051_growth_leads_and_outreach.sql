CREATE TYPE "public"."lead_activity_kind" AS ENUM('note', 'call', 'email', 'sms', 'whatsapp', 'meeting', 'status');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'interested', 'demo', 'trial', 'converted', 'lost');--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_name" text NOT NULL,
	"contact_name" text,
	"role" text,
	"email" text,
	"phone" text,
	"whatsapp" text,
	"country" text DEFAULT 'Nigeria' NOT NULL,
	"state" text,
	"city" text,
	"denomination" text,
	"size" integer,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"next_follow_up_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"converted_church_id" text,
	"converted_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "lead_activity_kind" DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"audience_kind" text NOT NULL,
	"audience_label" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid,
	"church_id" text,
	"name" text,
	"destination" text,
	"status" "delivery_status" NOT NULL,
	"error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_converted_church_id_church_id_fk" FOREIGN KEY ("converted_church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_campaign" ADD CONSTRAINT "outreach_campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_recipient" ADD CONSTRAINT "outreach_recipient_campaign_id_outreach_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_recipient" ADD CONSTRAINT "outreach_recipient_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_recipient" ADD CONSTRAINT "outreach_recipient_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_status_idx" ON "lead" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lead_follow_up_idx" ON "lead" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "lead_email_idx" ON "lead" USING btree ("email");--> statement-breakpoint
CREATE INDEX "lead_phone_idx" ON "lead" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "lead_created_idx" ON "lead" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lead_activity_lead_idx" ON "lead_activity" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "outreach_campaign_created_idx" ON "outreach_campaign" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outreach_recipient_campaign_idx" ON "outreach_recipient" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "outreach_recipient_status_idx" ON "outreach_recipient" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outreach_recipient_provider_idx" ON "outreach_recipient" USING btree ("provider_message_id");