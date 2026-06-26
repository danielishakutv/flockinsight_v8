ALTER TABLE "member" ADD COLUMN "wedding_date" date;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "baptized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "baptism_date" date;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "anniversaries" jsonb DEFAULT '[]'::jsonb NOT NULL;