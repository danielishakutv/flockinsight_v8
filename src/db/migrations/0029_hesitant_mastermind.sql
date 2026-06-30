CREATE TYPE "public"."form_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"title" text DEFAULT 'Untitled form' NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"status" "form_status" DEFAULT 'draft' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmation_message" text DEFAULT 'Thanks! Your response has been recorded.' NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"create_members" boolean DEFAULT true NOT NULL,
	"add_to_follow_up" boolean DEFAULT false NOT NULL,
	"response_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "form_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_church_idx" ON "form" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "form_response_form_idx" ON "form_response" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "form_response_church_idx" ON "form_response" USING btree ("church_id");