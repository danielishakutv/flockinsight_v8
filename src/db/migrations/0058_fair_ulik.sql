CREATE TYPE "public"."roadmap_priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."roadmap_status" AS ENUM('idea', 'planned', 'in_progress', 'shipped', 'parked');--> statement-breakpoint
CREATE TYPE "public"."training_cohort_status" AS ENUM('upcoming', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."training_enrollment_status" AS ENUM('enrolled', 'in_progress', 'completed', 'withdrawn', 'failed');--> statement-breakpoint
CREATE TYPE "public"."training_kind" AS ENUM('class', 'training', 'course');--> statement-breakpoint
CREATE TABLE "roadmap_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"status" "roadmap_status" DEFAULT 'idea' NOT NULL,
	"priority" "roadmap_priority" DEFAULT 'medium' NOT NULL,
	"area" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"target_date" date,
	"started_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"version" text,
	"churches_at_ship" integer,
	"users_at_ship" integer,
	"members_at_ship" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_cohort" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "training_cohort_status" DEFAULT 'upcoming' NOT NULL,
	"start_date" date,
	"end_date" date,
	"venue" text,
	"meeting_day" integer,
	"meeting_time" text,
	"capacity" integer,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "training_kind" DEFAULT 'class' NOT NULL,
	"description" text,
	"level" integer DEFAULT 1 NOT NULL,
	"badge_label" text,
	"badge_color" text DEFAULT 'indigo' NOT NULL,
	"badge_icon" text DEFAULT 'check' NOT NULL,
	"show_badge" boolean DEFAULT true NOT NULL,
	"pass_mark" integer,
	"issues_certificate" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"cohort_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "training_enrollment_status" DEFAULT 'enrolled' NOT NULL,
	"enrolled_at" date,
	"completed_at" date,
	"score" integer,
	"grade" text,
	"certificate_no" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_instructor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"member_id" uuid,
	"name" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmap_item" ADD CONSTRAINT "roadmap_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_cohort" ADD CONSTRAINT "training_cohort_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_cohort" ADD CONSTRAINT "training_cohort_course_id_training_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_cohort" ADD CONSTRAINT "training_cohort_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_course" ADD CONSTRAINT "training_course_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_course" ADD CONSTRAINT "training_course_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollment" ADD CONSTRAINT "training_enrollment_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollment" ADD CONSTRAINT "training_enrollment_cohort_id_training_cohort_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."training_cohort"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollment" ADD CONSTRAINT "training_enrollment_course_id_training_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollment" ADD CONSTRAINT "training_enrollment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollment" ADD CONSTRAINT "training_enrollment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_instructor" ADD CONSTRAINT "training_instructor_cohort_id_training_cohort_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."training_cohort"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_instructor" ADD CONSTRAINT "training_instructor_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roadmap_status_idx" ON "roadmap_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "roadmap_status_position_idx" ON "roadmap_item" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "roadmap_shipped_idx" ON "roadmap_item" USING btree ("shipped_at");--> statement-breakpoint
CREATE INDEX "training_cohort_church_idx" ON "training_cohort" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "training_cohort_course_idx" ON "training_cohort" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_course_church_idx" ON "training_course" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "training_course_church_active_idx" ON "training_course" USING btree ("church_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "training_enrollment_unique" ON "training_enrollment" USING btree ("cohort_id","member_id");--> statement-breakpoint
CREATE INDEX "training_enrollment_church_idx" ON "training_enrollment" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "training_enrollment_cohort_idx" ON "training_enrollment" USING btree ("cohort_id");--> statement-breakpoint
CREATE INDEX "training_enrollment_member_status_idx" ON "training_enrollment" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "training_enrollment_course_idx" ON "training_enrollment" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_instructor_cohort_idx" ON "training_instructor" USING btree ("cohort_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_instructor_unique" ON "training_instructor" USING btree ("cohort_id","member_id");