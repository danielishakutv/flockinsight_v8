CREATE TYPE "public"."broadcast_status" AS ENUM('scheduled', 'sent', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" "notification_category" DEFAULT 'general' NOT NULL,
	"audience" "notification_audience" DEFAULT 'all' NOT NULL,
	"target_plan" "plan",
	"target_country" text,
	"church_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link_url" text,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "broadcast_status" DEFAULT 'scheduled' NOT NULL,
	"sent_at" timestamp with time zone,
	"push_sent" integer DEFAULT 0 NOT NULL,
	"email_sent" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast" ADD CONSTRAINT "broadcast_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "broadcast_status_idx" ON "broadcast" USING btree ("status","scheduled_at");