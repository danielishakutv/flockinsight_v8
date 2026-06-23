CREATE TYPE "public"."follow_up_status" AS ENUM('new', 'contacted', 'in_progress', 'joined', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."interaction_outcome" AS ENUM('reached', 'no_response', 'scheduled', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('visit', 'call', 'sms', 'whatsapp', 'email', 'note');--> statement-breakpoint
CREATE TABLE "follow_up_interaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"type" "interaction_type" NOT NULL,
	"outcome" "interaction_outcome",
	"notes" text,
	"occurred_at" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "in_follow_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "follow_up_status" "follow_up_status";--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "assigned_to_id" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_up_interaction" ADD CONSTRAINT "follow_up_interaction_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_interaction" ADD CONSTRAINT "follow_up_interaction_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_interaction" ADD CONSTRAINT "follow_up_interaction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_up_member_idx" ON "follow_up_interaction" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "follow_up_church_idx" ON "follow_up_interaction" USING btree ("church_id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;