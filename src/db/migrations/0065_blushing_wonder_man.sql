CREATE TABLE "notification_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" text,
	"church_id" text,
	"name" text,
	"email" text NOT NULL,
	"status" "delivery_status" DEFAULT 'sent' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "source_body" text;--> statement-breakpoint
ALTER TABLE "notification_receipt" ADD CONSTRAINT "notification_receipt_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipt" ADD CONSTRAINT "notification_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipt" ADD CONSTRAINT "notification_receipt_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_receipt_notification_idx" ON "notification_receipt" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_receipt_provider_idx" ON "notification_receipt" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notification_receipt_email_idx" ON "notification_receipt" USING btree ("email");