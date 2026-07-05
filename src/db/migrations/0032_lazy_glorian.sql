ALTER TABLE "attendance_session" ADD COLUMN "teen_male_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "teen_female_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "child_male_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "child_female_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "first_timer_male_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "first_timer_female_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "new_convert_male_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD COLUMN "new_convert_female_count" integer DEFAULT 0 NOT NULL;