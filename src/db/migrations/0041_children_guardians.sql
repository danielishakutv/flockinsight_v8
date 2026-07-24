ALTER TABLE "member" ADD COLUMN "is_minor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "guardian_id" uuid;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "relationship" text;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_guardian_id_member_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_guardian_idx" ON "member" USING btree ("guardian_id");