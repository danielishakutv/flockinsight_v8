CREATE TYPE "public"."giving_method" AS ENUM('cash', 'transfer', 'card', 'cheque', 'online', 'other');--> statement-breakpoint
CREATE TABLE "giving" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"category_id" uuid,
	"member_id" uuid,
	"giver_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"method" "giving_method",
	"date" date NOT NULL,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giving_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "currency" text DEFAULT 'NGN' NOT NULL;--> statement-breakpoint
ALTER TABLE "giving" ADD CONSTRAINT "giving_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving" ADD CONSTRAINT "giving_category_id_giving_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."giving_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving" ADD CONSTRAINT "giving_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving" ADD CONSTRAINT "giving_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_category" ADD CONSTRAINT "giving_category_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giving_church_idx" ON "giving" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "giving_date_idx" ON "giving" USING btree ("date");--> statement-breakpoint
CREATE INDEX "giving_category_idx" ON "giving" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "giving_category_church_idx" ON "giving_category" USING btree ("church_id");