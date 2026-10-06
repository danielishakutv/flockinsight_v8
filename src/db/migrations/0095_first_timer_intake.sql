CREATE TABLE "first_timer_signup" (
	"church_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"title" text DEFAULT 'Welcome! Tell us about yourself' NOT NULL,
	"intro" text DEFAULT 'We are so glad you came. Leave your details and someone will say hello this week.' NOT NULL,
	"success_message" text DEFAULT 'Thank you — we are glad you came. We will be in touch soon.' NOT NULL,
	"collect_email" boolean DEFAULT true NOT NULL,
	"collect_address" boolean DEFAULT false NOT NULL,
	"collect_invited_by" boolean DEFAULT true NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "first_timer_signup_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "first_visit_date" date;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "invited_by_id" uuid;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "invited_by_name" text;--> statement-breakpoint
ALTER TABLE "first_timer_signup" ADD CONSTRAINT "first_timer_signup_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_invited_by_id_member_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;