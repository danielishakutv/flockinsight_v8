ALTER TYPE "public"."broadcast_status" ADD VALUE 'draft' BEFORE 'scheduled';--> statement-breakpoint
ALTER TABLE "broadcast" ALTER COLUMN "scheduled_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "broadcast" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_source_version_idx" ON "broadcast" USING btree ("source_version");