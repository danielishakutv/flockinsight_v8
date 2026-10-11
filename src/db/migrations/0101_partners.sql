CREATE TYPE "public"."partner_earning_kind" AS ENUM('first', 'second', 'trail', 'bonus');--> statement-breakpoint
CREATE TYPE "public"."partner_earning_status" AS ENUM('pending', 'available', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."partner_payout_status" AS ENUM('requested', 'approved', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"status" "partner_status" DEFAULT 'pending' NOT NULL,
	"bank_name" text,
	"bank_account_number" text,
	"bank_account_name" text,
	"tier_override" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "partner_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "partner_earning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"church_id" text,
	"payment_id" uuid,
	"kind" "partner_earning_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"status" "partner_earning_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone,
	"payout_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" "partner_payout_status" DEFAULT 'requested' NOT NULL,
	"bank_name" text,
	"bank_account_number" text,
	"bank_account_name" text,
	"reference" text,
	"note" text,
	"decided_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_referral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"source" text DEFAULT 'link' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_referral_churchId_unique" UNIQUE("church_id")
);
--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earning" ADD CONSTRAINT "partner_earning_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earning" ADD CONSTRAINT "partner_earning_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earning" ADD CONSTRAINT "partner_earning_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout" ADD CONSTRAINT "partner_payout_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout" ADD CONSTRAINT "partner_payout_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral" ADD CONSTRAINT "partner_referral_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral" ADD CONSTRAINT "partner_referral_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_status_idx" ON "partner" USING btree ("status");--> statement-breakpoint
CREATE INDEX "partner_earning_partner_idx" ON "partner_earning" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_earning_once_idx" ON "partner_earning" USING btree ("payment_id","kind");--> statement-breakpoint
CREATE INDEX "partner_payout_partner_idx" ON "partner_payout" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_referral_partner_idx" ON "partner_referral" USING btree ("partner_id");