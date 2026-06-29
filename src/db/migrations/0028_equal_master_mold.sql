CREATE TYPE "public"."wallet_txn_category" AS ENUM('topup', 'sms', 'storage', 'adjustment', 'refund');--> statement-breakpoint
CREATE TYPE "public"."wallet_txn_kind" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TABLE "wallet_topup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "wallet_topup_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "wallet_txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"kind" "wallet_txn_kind" NOT NULL,
	"category" "wallet_txn_category" DEFAULT 'adjustment' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "wallet_balance" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "storage_extra_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "storage_monthly_cost" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "storage_renews_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "provider" text DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "public_id" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "resource_type" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "duration_sec" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "wallet_topup" ADD CONSTRAINT "wallet_topup_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topup" ADD CONSTRAINT "wallet_topup_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_txn" ADD CONSTRAINT "wallet_txn_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_txn" ADD CONSTRAINT "wallet_txn_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_topup_church_idx" ON "wallet_topup" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "wallet_txn_church_idx" ON "wallet_txn" USING btree ("church_id");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_church_kind_idx" ON "media" USING btree ("church_id","kind");--> statement-breakpoint
-- Unify the wallet: seed the new balance from the legacy SMS balance.
UPDATE "church" SET "wallet_balance" = "sms_balance" WHERE "sms_balance" <> 0;--> statement-breakpoint
-- Backfill the authoritative byte count for existing db-backed media rows.
UPDATE "media" SET "bytes" = "size" WHERE "bytes" = 0 AND "size" > 0;--> statement-breakpoint
-- Carry the SMS wallet ledger into the unified ledger (originals are preserved).
INSERT INTO "wallet_txn" ("id", "church_id", "kind", "category", "amount", "balance_after", "reason", "created_by", "created_at")
SELECT "id", "church_id", "kind"::text::"wallet_txn_kind",
       (CASE WHEN "kind" = 'credit' THEN 'topup' ELSE 'sms' END)::"wallet_txn_category",
       "amount", "balance_after", "reason", "created_by", "created_at"
FROM "sms_wallet_txn";