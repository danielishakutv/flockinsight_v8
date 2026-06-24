CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_church_idx" ON "role" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_church_name_idx" ON "role" USING btree ("church_id","name");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE set null ON UPDATE no action;