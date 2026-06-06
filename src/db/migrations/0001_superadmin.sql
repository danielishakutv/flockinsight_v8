CREATE TYPE "public"."church_status" AS ENUM('active', 'suspended');--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "status" "church_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_super_admin" boolean DEFAULT false NOT NULL;