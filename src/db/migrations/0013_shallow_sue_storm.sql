CREATE TYPE "public"."communication_channel" AS ENUM('sms', 'email', 'notification');--> statement-breakpoint
CREATE TABLE "communication_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"audience" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comm_log_church_idx" ON "communication_log" USING btree ("church_id");