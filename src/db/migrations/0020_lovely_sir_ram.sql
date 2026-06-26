CREATE TABLE "celebration_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"member_id" uuid,
	"kind" text NOT NULL,
	"on_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "celebration_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"send_time" text DEFAULT '08:00' NOT NULL,
	"birthday_sms" text DEFAULT 'Happy birthday, {name}! 🎉 Everyone at {church} celebrates you today. Have a blessed year!' NOT NULL,
	"birthday_email_subject" text DEFAULT 'Happy Birthday, {name}! 🎉' NOT NULL,
	"birthday_email_body" text DEFAULT 'Dear {name},

Happy birthday! On behalf of the entire {church} family, we celebrate the gift of your life today. May this new year be filled with God''s blessings, joy and good health.

We love and appreciate you!' NOT NULL,
	"anniversary_sms" text DEFAULT 'Happy {occasion}, {name}! 🎊 {church} celebrates with you today. God bless you!' NOT NULL,
	"anniversary_email_subject" text DEFAULT 'Happy {occasion}, {name}!' NOT NULL,
	"anniversary_email_body" text DEFAULT 'Dear {name},

Congratulations on your {occasion}! The {church} family rejoices with you and prays God''s continued blessing over you.

With love,
{church}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "celebration_run" ADD CONSTRAINT "celebration_run_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebration_run" ADD CONSTRAINT "celebration_run_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebration_setting" ADD CONSTRAINT "celebration_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "celebration_run_unique" ON "celebration_run" USING btree ("member_id","kind","on_date");