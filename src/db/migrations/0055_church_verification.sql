CREATE TYPE "public"."kyc_status" AS ENUM('not_started', 'pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "kyc_status" "kyc_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
-- Seed the account contact from what we already know, so a church opens the
-- verification page with its details pre-filled rather than a blank form.
-- Nothing is marked verified: every church proves ownership with a code.
UPDATE "church" SET "contact_email" = (
  SELECT u."email" FROM "staff" s
  JOIN "user" u ON u."id" = s."user_id"
  WHERE s."organization_id" = "church"."id" AND s."role" = 'owner' AND s."temp" = false
  ORDER BY s."created_at" ASC
  LIMIT 1
) WHERE "contact_email" IS NULL;--> statement-breakpoint
UPDATE "church" SET "contact_phone" = "public_phone"
  WHERE "contact_phone" IS NULL AND "public_phone" IS NOT NULL AND "public_phone" <> '';
