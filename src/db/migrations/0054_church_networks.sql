CREATE TYPE "public"."branch_request_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hq_report_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "branch_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_church_id" text NOT NULL,
	"child_church_id" text,
	"invite_email" text,
	"status" "branch_request_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"requested_by" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_report_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"frequency" "hq_report_frequency" DEFAULT 'weekly' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "parent_church_id" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "zone" text;--> statement-breakpoint
ALTER TABLE "branch_request" ADD CONSTRAINT "branch_request_parent_church_id_church_id_fk" FOREIGN KEY ("parent_church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_request" ADD CONSTRAINT "branch_request_child_church_id_church_id_fk" FOREIGN KEY ("child_church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_request" ADD CONSTRAINT "branch_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_report_setting" ADD CONSTRAINT "hq_report_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_request_parent_idx" ON "branch_request" USING btree ("parent_church_id");--> statement-breakpoint
CREATE INDEX "branch_request_child_idx" ON "branch_request" USING btree ("child_church_id","status");--> statement-breakpoint
ALTER TABLE "church" ADD CONSTRAINT "church_parent_church_id_church_id_fk" FOREIGN KEY ("parent_church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "church_parent_idx" ON "church" USING btree ("parent_church_id");