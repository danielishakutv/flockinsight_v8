ALTER TABLE "member_signup" ADD COLUMN "confirm_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "member_signup" ADD COLUMN "confirm_sms" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_signup" ADD COLUMN "confirm_subject" text DEFAULT 'Welcome to {church}' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_signup" ADD COLUMN "confirm_message" text DEFAULT 'Hi {name}, thank you for registering with {church}. We''re glad to have you — see you soon!' NOT NULL;