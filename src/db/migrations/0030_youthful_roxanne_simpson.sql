CREATE TYPE "public"."devotional_status" AS ENUM('draft', 'scheduled', 'sent');--> statement-breakpoint
CREATE TYPE "public"."devotional_type" AS ENUM('devotional', 'newsletter');--> statement-breakpoint
CREATE TABLE "devotional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"type" "devotional_type" DEFAULT 'devotional' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"image_url" text,
	"audience" text DEFAULT 'both' NOT NULL,
	"status" "devotional_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriber" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "theme" text DEFAULT 'indigo' NOT NULL;--> statement-breakpoint
ALTER TABLE "devotional" ADD CONSTRAINT "devotional_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devotional" ADD CONSTRAINT "devotional_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber" ADD CONSTRAINT "subscriber_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devotional_church_idx" ON "devotional" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "devotional_status_idx" ON "devotional" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "subscriber_church_idx" ON "subscriber" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriber_church_email_idx" ON "subscriber" USING btree ("church_id","email");