ALTER TYPE "public"."notification_audience" ADD VALUE 'user';--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "target_user_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;