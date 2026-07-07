CREATE TYPE "public"."blog_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "blog_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text DEFAULT '' NOT NULL,
	"cover_url" text,
	"status" "blog_status" DEFAULT 'draft' NOT NULL,
	"author_name" text DEFAULT 'The FlockInsight Team' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"views" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "first_timer_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "first_timer_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"send_time" text DEFAULT '10:00' NOT NULL,
	"welcome_delay_days" integer DEFAULT 1 NOT NULL,
	"invite_delay_days" integer DEFAULT 14 NOT NULL,
	"welcome_sms" text DEFAULT 'Hi {name}, it was a joy to have you at {church}! 🙏 Thank you for worshipping with us. We''d love to see you again soon.' NOT NULL,
	"welcome_email_subject" text DEFAULT 'Thank you for visiting {church}, {name}!' NOT NULL,
	"welcome_email_body" text DEFAULT 'Dear {name},

Thank you so much for visiting {church}! It was a joy to have you worship with us.

We''d love to stay connected and see you again. If there''s any way we can pray for you or serve you, please let us know.

With love,
{church}' NOT NULL,
	"invite_sms" text DEFAULT 'Hi {name}, we''d love for you to become part of the {church} family! Complete your membership here: {link}' NOT NULL,
	"invite_email_subject" text DEFAULT 'Become part of the {church} family, {name}' NOT NULL,
	"invite_email_body" text DEFAULT 'Dear {name},

We''ve loved having you with us these past couple of weeks. We''d be honoured to have you become a full member of the {church} family.

It only takes a minute — just complete your details here:
{link}

We look forward to walking this journey with you.

With love,
{church}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_signup" (
	"church_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"title" text DEFAULT 'Join our church family' NOT NULL,
	"intro" text DEFAULT 'Fill in your details below so we can stay connected with you. It only takes a minute.' NOT NULL,
	"success_message" text DEFAULT 'Thank you! Your details have been saved. We''re glad to have you.' NOT NULL,
	"new_member_status" text DEFAULT 'active' NOT NULL,
	"collect_birthday" boolean DEFAULT true NOT NULL,
	"collect_address" boolean DEFAULT true NOT NULL,
	"collect_anniversary" boolean DEFAULT true NOT NULL,
	"allow_group_select" boolean DEFAULT true NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_signup_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "otp_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text,
	"purpose" text NOT NULL,
	"channel" text NOT NULL,
	"destination" text NOT NULL,
	"code_hash" text NOT NULL,
	"member_id" uuid,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD CONSTRAINT "first_timer_run_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_timer_run" ADD CONSTRAINT "first_timer_run_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_timer_setting" ADD CONSTRAINT "first_timer_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_signup" ADD CONSTRAINT "member_signup_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_code" ADD CONSTRAINT "otp_code_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_code" ADD CONSTRAINT "otp_code_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_status_idx" ON "blog_post" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "blog_slug_idx" ON "blog_post" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "first_timer_run_unique" ON "first_timer_run" USING btree ("member_id","stage");--> statement-breakpoint
CREATE INDEX "otp_lookup_idx" ON "otp_code" USING btree ("destination","purpose");--> statement-breakpoint
CREATE INDEX "otp_expires_idx" ON "otp_code" USING btree ("expires_at");