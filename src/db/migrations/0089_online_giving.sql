CREATE TYPE "public"."give_amount_mode" AS ENUM('open', 'fixed', 'preset');--> statement-breakpoint
CREATE TYPE "public"."online_payment_status" AS ENUM('pending', 'success', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('paystack', 'flutterwave', 'monnify', 'link');--> statement-breakpoint
CREATE TABLE "church_gateway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"public_key" text,
	"secret_sealed" text,
	"extra_sealed" text,
	"link_url" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giving_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"amount_mode" "give_amount_mode" DEFAULT 'open' NOT NULL,
	"fixed_amount" numeric(14, 2),
	"preset_amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_amount" numeric(14, 2),
	"target_amount" numeric(14, 2),
	"ask_phone" boolean DEFAULT true NOT NULL,
	"allow_anonymous" boolean DEFAULT true NOT NULL,
	"show_progress" boolean DEFAULT false NOT NULL,
	"thank_you_message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"closes_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_link_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "online_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"link_id" uuid,
	"provider" "payment_provider" NOT NULL,
	"reference" text NOT NULL,
	"gateway_ref" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"status" "online_payment_status" DEFAULT 'pending' NOT NULL,
	"giver_name" text,
	"giver_email" text,
	"giver_phone" text,
	"member_id" uuid,
	"note" text,
	"giving_id" uuid,
	"fail_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_payment_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "church_gateway" ADD CONSTRAINT "church_gateway_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_gateway" ADD CONSTRAINT "church_gateway_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_link" ADD CONSTRAINT "giving_link_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_link" ADD CONSTRAINT "giving_link_category_id_giving_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."giving_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_link" ADD CONSTRAINT "giving_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_link_id_giving_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."giving_link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_giving_id_giving_id_fk" FOREIGN KEY ("giving_id") REFERENCES "public"."giving"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "church_gateway_provider_idx" ON "church_gateway" USING btree ("church_id","provider");--> statement-breakpoint
CREATE INDEX "church_gateway_church_idx" ON "church_gateway" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "giving_link_church_idx" ON "giving_link" USING btree ("church_id","is_active");--> statement-breakpoint
CREATE INDEX "online_payment_church_idx" ON "online_payment" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "online_payment_link_idx" ON "online_payment" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "online_payment_created_idx" ON "online_payment" USING btree ("created_at");