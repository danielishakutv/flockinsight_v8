CREATE TYPE "public"."qr_code_kind" AS ENUM('link', 'url', 'text', 'wifi', 'phone', 'sms', 'whatsapp', 'email', 'contact', 'location', 'event');--> statement-breakpoint
CREATE TYPE "public"."short_link_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "qr_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"title" text DEFAULT 'Untitled code' NOT NULL,
	"kind" "qr_code_kind" DEFAULT 'url' NOT NULL,
	"payload" jsonb DEFAULT '{"kind":"url","url":""}'::jsonb NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"short_link_id" uuid,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text,
	"destination" text NOT NULL,
	"status" "short_link_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"last_click_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "short_link_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "short_link_destination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"destination" text NOT NULL,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_link_stat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_short_link_id_short_link_id_fk" FOREIGN KEY ("short_link_id") REFERENCES "public"."short_link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link" ADD CONSTRAINT "short_link_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link" ADD CONSTRAINT "short_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_destination" ADD CONSTRAINT "short_link_destination_link_id_short_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."short_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_destination" ADD CONSTRAINT "short_link_destination_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_destination" ADD CONSTRAINT "short_link_destination_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_stat" ADD CONSTRAINT "short_link_stat_link_id_short_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."short_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_stat" ADD CONSTRAINT "short_link_stat_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qr_code_church_idx" ON "qr_code" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "qr_code_link_idx" ON "qr_code" USING btree ("short_link_id");--> statement-breakpoint
CREATE INDEX "short_link_church_idx" ON "short_link" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "short_link_status_idx" ON "short_link" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "short_link_destination_link_idx" ON "short_link_destination" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE INDEX "short_link_stat_link_idx" ON "short_link_stat" USING btree ("link_id","bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "short_link_stat_unique" ON "short_link_stat" USING btree ("link_id","bucket","key");