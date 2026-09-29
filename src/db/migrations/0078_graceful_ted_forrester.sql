CREATE TABLE "platform_survey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Untitled survey' NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"status" "form_status" DEFAULT 'draft' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" "notification_audience" DEFAULT 'all' NOT NULL,
	"target_plan" "plan",
	"target_country" text,
	"church_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "platform_survey_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_survey_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"church_id" text,
	"user_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_survey" ADD CONSTRAINT "platform_survey_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_survey_response" ADD CONSTRAINT "platform_survey_response_survey_id_platform_survey_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."platform_survey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_survey_response" ADD CONSTRAINT "platform_survey_response_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_survey_response" ADD CONSTRAINT "platform_survey_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_survey_status_idx" ON "platform_survey" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_survey_response_survey_idx" ON "platform_survey_response" USING btree ("survey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_survey_response_once" ON "platform_survey_response" USING btree ("survey_id","church_id") WHERE church_id is not null;