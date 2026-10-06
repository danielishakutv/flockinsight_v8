CREATE TYPE "public"."facility_booking_status" AS ENUM('requested', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."facility_closure_kind" AS ENUM('maintenance', 'repair', 'cleaning', 'reserved', 'other');--> statement-breakpoint
CREATE TYPE "public"."facility_kind" AS ENUM('hall', 'room', 'open_space', 'equipment', 'vehicle', 'other');--> statement-breakpoint
CREATE TYPE "public"."facility_rate" AS ENUM('free', 'hour', 'day', 'session');--> statement-breakpoint
CREATE TABLE "facility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "facility_kind" DEFAULT 'hall' NOT NULL,
	"location" text,
	"description" text,
	"capacity" integer,
	"photo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_bookable" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"hire_fee" numeric(14, 2),
	"rate" "facility_rate" DEFAULT 'free' NOT NULL,
	"contact_member_id" uuid,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"title" text NOT NULL,
	"purpose" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "facility_booking_status" DEFAULT 'requested' NOT NULL,
	"member_id" uuid,
	"requester_name" text,
	"requester_phone" text,
	"requester_email" text,
	"is_external" boolean DEFAULT false NOT NULL,
	"group_id" uuid,
	"event_id" uuid,
	"expected_attendance" integer,
	"fee" numeric(14, 2),
	"fee_paid" boolean DEFAULT false NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"kind" "facility_closure_kind" DEFAULT 'maintenance' NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cost" numeric(14, 2),
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facility" ADD CONSTRAINT "facility_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility" ADD CONSTRAINT "facility_contact_member_id_member_id_fk" FOREIGN KEY ("contact_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility" ADD CONSTRAINT "facility_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_group_id_church_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."church_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_booking" ADD CONSTRAINT "facility_booking_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_closure" ADD CONSTRAINT "facility_closure_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_closure" ADD CONSTRAINT "facility_closure_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_closure" ADD CONSTRAINT "facility_closure_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_church_idx" ON "facility" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "facility_church_active_idx" ON "facility" USING btree ("church_id","is_active");--> statement-breakpoint
CREATE INDEX "facility_booking_church_idx" ON "facility_booking" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "facility_booking_facility_time_idx" ON "facility_booking" USING btree ("facility_id","starts_at");--> statement-breakpoint
CREATE INDEX "facility_booking_church_status_idx" ON "facility_booking" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "facility_booking_time_idx" ON "facility_booking" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "facility_closure_church_idx" ON "facility_closure" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "facility_closure_facility_time_idx" ON "facility_closure" USING btree ("facility_id","starts_at");