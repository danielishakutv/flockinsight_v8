CREATE TYPE "public"."group_type" AS ENUM('ministry', 'department', 'group', 'cell', 'committee', 'class');--> statement-breakpoint
CREATE TABLE "church_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "group_type" DEFAULT 'ministry' NOT NULL,
	"description" text,
	"meeting_day" integer,
	"meeting_time" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"is_leader" boolean DEFAULT false NOT NULL,
	"role" text,
	"joined_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church_group" ADD CONSTRAINT "church_group_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_group" ADD CONSTRAINT "church_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_group_id_church_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."church_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_church_idx" ON "church_group" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_membership_unique" ON "group_membership" USING btree ("group_id","member_id");--> statement-breakpoint
CREATE INDEX "group_membership_member_idx" ON "group_membership" USING btree ("member_id");