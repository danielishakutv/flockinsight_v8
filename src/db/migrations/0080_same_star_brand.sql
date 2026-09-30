CREATE TABLE "translation_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text NOT NULL,
	"church_id" text,
	"user_id" text,
	"path" text,
	"original" text,
	"suggestion" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "translation_feedback" ADD CONSTRAINT "translation_feedback_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_feedback" ADD CONSTRAINT "translation_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "translation_feedback_locale_idx" ON "translation_feedback" USING btree ("locale","status");--> statement-breakpoint
CREATE INDEX "translation_feedback_created_idx" ON "translation_feedback" USING btree ("created_at");