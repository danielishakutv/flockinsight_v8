CREATE TABLE "custom_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"base_plan" "plan" DEFAULT 'starter' NOT NULL,
	"price_monthly" integer,
	"member_limit" integer,
	"team_limit" integer,
	"email_allowance" integer,
	"storage_mb" integer DEFAULT 200 NOT NULL,
	"features_added" text[] DEFAULT '{}'::text[] NOT NULL,
	"features_removed" text[] DEFAULT '{}'::text[] NOT NULL,
	"highlights" text[] DEFAULT '{}'::text[] NOT NULL,
	"show_on_website" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_plan_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "custom_plan_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "custom_plan_id" text;--> statement-breakpoint
ALTER TABLE "custom_plan" ADD CONSTRAINT "custom_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church" ADD CONSTRAINT "church_custom_plan_id_custom_plan_id_fk" FOREIGN KEY ("custom_plan_id") REFERENCES "public"."custom_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_custom_plan_id_custom_plan_id_fk" FOREIGN KEY ("custom_plan_id") REFERENCES "public"."custom_plan"("id") ON DELETE set null ON UPDATE no action;