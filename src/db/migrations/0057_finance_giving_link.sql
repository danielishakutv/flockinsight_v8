CREATE TABLE "finance_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"date" date NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_account" ADD COLUMN "giving_category_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD COLUMN "giving_id" uuid;--> statement-breakpoint
ALTER TABLE "giving_category" ADD COLUMN "auto_finance_account" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_transfer" ADD CONSTRAINT "finance_transfer_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfer" ADD CONSTRAINT "finance_transfer_from_account_id_finance_account_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."finance_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfer" ADD CONSTRAINT "finance_transfer_to_account_id_finance_account_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."finance_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfer" ADD CONSTRAINT "finance_transfer_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_transfer_church_idx" ON "finance_transfer" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "finance_transfer_date_idx" ON "finance_transfer" USING btree ("date");--> statement-breakpoint
CREATE INDEX "finance_transfer_from_idx" ON "finance_transfer" USING btree ("from_account_id");--> statement-breakpoint
CREATE INDEX "finance_transfer_to_idx" ON "finance_transfer" USING btree ("to_account_id");--> statement-breakpoint
CREATE INDEX "finance_transfer_church_date_idx" ON "finance_transfer" USING btree ("church_id","date");--> statement-breakpoint
ALTER TABLE "finance_account" ADD CONSTRAINT "finance_account_giving_category_id_giving_category_id_fk" FOREIGN KEY ("giving_category_id") REFERENCES "public"."giving_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_giving_id_giving_id_fk" FOREIGN KEY ("giving_id") REFERENCES "public"."giving"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_account_giving_category_idx" ON "finance_account" USING btree ("giving_category_id");