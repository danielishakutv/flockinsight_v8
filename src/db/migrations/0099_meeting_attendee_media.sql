ALTER TABLE "meeting" ADD COLUMN "allow_attendee_mic" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "allow_attendee_camera" boolean DEFAULT true NOT NULL;