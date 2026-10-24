ALTER TYPE "public"."partner_status" ADD VALUE 'paused' BEFORE 'suspended';--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "status_changed_at" timestamp with time zone;