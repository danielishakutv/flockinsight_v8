ALTER TABLE "media" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "transcode_status" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "transcode_error" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "original_bytes" bigint;