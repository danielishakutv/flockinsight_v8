CREATE TABLE "sms_topup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "sms_topup_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "sms_topup" ADD CONSTRAINT "sms_topup_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_topup" ADD CONSTRAINT "sms_topup_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_topup_church_idx" ON "sms_topup" USING btree ("church_id");