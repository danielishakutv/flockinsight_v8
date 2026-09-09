ALTER TABLE "church" ADD COLUMN "referred_by_church_id" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "referred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "church" ADD CONSTRAINT "church_referred_by_church_id_church_id_fk" FOREIGN KEY ("referred_by_church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;