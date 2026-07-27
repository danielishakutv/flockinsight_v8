CREATE TABLE "pledge_reminder_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"pledge_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"sent_email" integer DEFAULT 0 NOT NULL,
	"sent_sms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pledge_reminder_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"email_subject" text DEFAULT 'A note about your {project} pledge — {church}' NOT NULL,
	"email_body" text DEFAULT 'Dear {name},

Thank you for your pledge of {amount} toward {project}. So far {paid} has been received, leaving {outstanding} outstanding. Whenever you''re able to give your {cadence} portion, it''s a great blessing to the work.

"Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver." (2 Corinthians 9:7)

God bless you,
{church}' NOT NULL,
	"sms_body" text DEFAULT 'Dear {name}, thank you for your {project} pledge. {paid} received, {outstanding} outstanding. God bless you! — {church}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD CONSTRAINT "pledge_reminder_run_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD CONSTRAINT "pledge_reminder_run_pledge_id_pledge_id_fk" FOREIGN KEY ("pledge_id") REFERENCES "public"."pledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledge_reminder_setting" ADD CONSTRAINT "pledge_reminder_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pledge_reminder_run_unique" ON "pledge_reminder_run" USING btree ("pledge_id","period_key");