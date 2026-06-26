CREATE TABLE "reminder_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"service_id" uuid,
	"service_date" date NOT NULL,
	"sent_sms" integer DEFAULT 0 NOT NULL,
	"sent_email" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"day_before" boolean DEFAULT false NOT NULL,
	"send_time" text DEFAULT '07:00' NOT NULL,
	"audience" text DEFAULT 'active' NOT NULL,
	"sms_template" text DEFAULT 'Hi {name}, reminder: {service} holds {day} {time} at {church}. We can''t wait to see you!' NOT NULL,
	"email_subject" text DEFAULT 'See you at {church} for {service}' NOT NULL,
	"email_template" text DEFAULT 'Hi {name},

This is a friendly reminder that {service} holds {day} at {time}.

We look forward to worshipping with you at {church}!' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminder_run" ADD CONSTRAINT "reminder_run_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD CONSTRAINT "reminder_run_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_setting" ADD CONSTRAINT "reminder_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_run_unique" ON "reminder_run" USING btree ("service_id","service_date");