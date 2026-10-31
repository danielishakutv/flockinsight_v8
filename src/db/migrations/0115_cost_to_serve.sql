CREATE TABLE "platform_cost_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vendor" text,
	"category" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"frequency" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"spread_months" integer,
	"purpose" text,
	"driver" text NOT NULL,
	"channel" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "platform_cost_item_amount_chk" CHECK ("platform_cost_item"."amount" >= 0),
	CONSTRAINT "platform_cost_item_frequency_chk" CHECK ("platform_cost_item"."frequency" in ('one_off','monthly','quarterly','yearly')),
	CONSTRAINT "platform_cost_item_dates_chk" CHECK ("platform_cost_item"."ends_on" is null or "platform_cost_item"."ends_on" >= "platform_cost_item"."starts_on"),
	CONSTRAINT "platform_cost_item_spread_chk" CHECK ("platform_cost_item"."spread_months" is null or ("platform_cost_item"."frequency" = 'one_off' and "platform_cost_item"."spread_months" between 1 and 120))
);
--> statement-breakpoint
CREATE TABLE "platform_income_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_on" date NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"amount_ngn" numeric(14, 2) NOT NULL,
	"source" text,
	"church_id" text,
	"reference" text,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "platform_income_entry_amount_chk" CHECK ("platform_income_entry"."amount" > 0 and "platform_income_entry"."amount_ngn" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_fee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "wallet_topup" ADD COLUMN "gateway_fee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "platform_cost_item" ADD CONSTRAINT "platform_cost_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_income_entry" ADD CONSTRAINT "platform_income_entry_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_income_entry" ADD CONSTRAINT "platform_income_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_cost_item_active_idx" ON "platform_cost_item" USING btree ("archived_at","starts_on");--> statement-breakpoint
CREATE INDEX "platform_income_entry_received_idx" ON "platform_income_entry" USING btree ("received_on");