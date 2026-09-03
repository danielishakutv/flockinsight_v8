CREATE TYPE "public"."finance_account_type" AS ENUM('bank', 'cash', 'mobile_money', 'other');--> statement-breakpoint
CREATE TYPE "public"."finance_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."finance_method" AS ENUM('cash', 'transfer', 'card', 'cheque', 'online', 'other');--> statement-breakpoint
CREATE TABLE "finance_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "finance_account_type" DEFAULT 'bank' NOT NULL,
	"institution" text,
	"account_number" text,
	"opening_balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "finance_kind" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"kind" "finance_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"party" text,
	"reference" text,
	"method" "finance_method",
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_account" ADD CONSTRAINT "finance_account_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_account" ADD CONSTRAINT "finance_account_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_category" ADD CONSTRAINT "finance_category_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_account_id_finance_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_category_id_finance_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_account_church_idx" ON "finance_account" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_account_name_idx" ON "finance_account" USING btree ("church_id","name");--> statement-breakpoint
CREATE INDEX "finance_category_church_idx" ON "finance_category" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_category_name_idx" ON "finance_category" USING btree ("church_id","kind","name");--> statement-breakpoint
CREATE INDEX "finance_txn_church_idx" ON "finance_transaction" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "finance_txn_date_idx" ON "finance_transaction" USING btree ("date");--> statement-breakpoint
CREATE INDEX "finance_txn_account_idx" ON "finance_transaction" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "finance_txn_category_idx" ON "finance_transaction" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "finance_txn_church_date_idx" ON "finance_transaction" USING btree ("church_id","date");--> statement-breakpoint
CREATE INDEX "finance_txn_church_kind_idx" ON "finance_transaction" USING btree ("church_id","kind");