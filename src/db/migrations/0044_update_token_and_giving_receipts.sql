CREATE TABLE "giving_receipt_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"email_subject" text DEFAULT 'Thank you for your {category} — {church}' NOT NULL,
	"email_body" text DEFAULT 'Dear {name},

We joyfully acknowledge your {category} of {amount} received on {date}. Thank you for your faithfulness and generosity to God''s work.

May the Lord bless you and keep you; may He make His face shine upon you and be gracious to you. "Bring the whole tithe into the storehouse... and see if I will not throw open the floodgates of heaven and pour out so much blessing that there will not be room enough to store it." (Malachi 3:10)

With gratitude,
{church}' NOT NULL,
	"sms_body" text DEFAULT 'Dear {name}, we acknowledge your {category} of {amount} on {date}. Thank you & may God bless you richly! — {church}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "update_token" text;--> statement-breakpoint
ALTER TABLE "giving_receipt_setting" ADD CONSTRAINT "giving_receipt_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_updateToken_unique" UNIQUE("update_token");