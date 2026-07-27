CREATE TYPE "public"."pledge_cadence" AS ENUM('one_time', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."pledge_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "pledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid,
	"giver_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"cadence" "pledge_cadence" DEFAULT 'one_time' NOT NULL,
	"cadence_label" text,
	"installment_amount" numeric(14, 2),
	"start_date" date,
	"status" "pledge_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_amount" numeric(14, 2),
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "giving" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "giving" ADD COLUMN "pledge_id" uuid;--> statement-breakpoint
ALTER TABLE "pledge" ADD CONSTRAINT "pledge_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledge" ADD CONSTRAINT "pledge_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledge" ADD CONSTRAINT "pledge_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledge" ADD CONSTRAINT "pledge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pledge_church_idx" ON "pledge" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "pledge_project_idx" ON "pledge" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pledge_member_idx" ON "pledge" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "project_church_idx" ON "project" USING btree ("church_id");--> statement-breakpoint
ALTER TABLE "giving" ADD CONSTRAINT "giving_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving" ADD CONSTRAINT "giving_pledge_id_pledge_id_fk" FOREIGN KEY ("pledge_id") REFERENCES "public"."pledge"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giving_project_idx" ON "giving" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "giving_pledge_idx" ON "giving" USING btree ("pledge_id");