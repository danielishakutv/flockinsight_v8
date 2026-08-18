CREATE TABLE "denomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "denomination_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "denomination_id" uuid;--> statement-breakpoint
ALTER TABLE "denomination" ADD CONSTRAINT "denomination_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "denomination_archived_idx" ON "denomination" USING btree ("archived");--> statement-breakpoint
ALTER TABLE "church" ADD CONSTRAINT "church_denomination_id_denomination_id_fk" FOREIGN KEY ("denomination_id") REFERENCES "public"."denomination"("id") ON DELETE set null ON UPDATE no action;