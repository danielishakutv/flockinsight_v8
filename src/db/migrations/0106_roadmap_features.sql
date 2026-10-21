CREATE TYPE "public"."certification_rank" AS ENUM('professional', 'master', 'expert');--> statement-breakpoint
CREATE TYPE "public"."pastor_closure_kind" AS ENUM('leave', 'travel', 'conference', 'sick', 'other');--> statement-breakpoint
CREATE TYPE "public"."pastoral_appointment_status" AS ENUM('pending', 'confirmed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pastoral_booking_source" AS ENUM('public', 'members', 'staff');--> statement-breakpoint
CREATE TYPE "public"."pastoral_booking_visibility" AS ENUM('public', 'members');--> statement-breakpoint
CREATE TYPE "public"."pastoral_location" AS ENUM('church', 'home', 'phone', 'online');--> statement-breakpoint
CREATE TABLE "ai_budget_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"subject" text NOT NULL,
	"spent_nano" bigint DEFAULT 0 NOT NULL,
	"reserved_nano" bigint DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_budget_month_nonneg" CHECK ("ai_budget_month"."spent_nano" >= 0 and "ai_budget_month"."reserved_nano" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text,
	"feature" text NOT NULL,
	"prompt_id" text NOT NULL,
	"payload_schema" text,
	"model" text NOT NULL,
	"served_model" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"actor_user_id" text,
	"budget_month" text NOT NULL,
	"reserved_nano" bigint NOT NULL,
	"cost_nano" bigint,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_write_tokens" integer,
	"cache_read_tokens" integer,
	"request_json" text NOT NULL,
	"request_sha256" text NOT NULL,
	"response_text" text,
	"stop_reason" text,
	"refusal_category" text,
	"provider_request_id" text,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ai_call_money_nonneg" CHECK ("ai_call"."reserved_nano" >= 0 and ("ai_call"."cost_nano" is null or "ai_call"."cost_nano" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ai_church_setting" (
	"church_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"changed_by_user_id" text,
	"enabled_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"church_id" text,
	"day" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"payload_sha256" text,
	"text" text,
	"reason" text,
	"call_id" uuid,
	"reused_from_id" uuid,
	"requested_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guide_slug" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"drafted_by_ai" boolean DEFAULT false NOT NULL,
	"source_message_id" uuid,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_answer_status_chk" CHECK ("assistant_answer"."status" in ('draft','approved','retired'))
);
--> statement-breakpoint
CREATE TABLE "assistant_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'church' NOT NULL,
	"church_id" text,
	"user_id" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_conversation_scope_chk" CHECK ("assistant_conversation"."scope" in ('church','platform') and (("assistant_conversation"."scope" = 'church') = ("assistant_conversation"."church_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "assistant_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"church_id" text,
	"user_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"redactions" integer DEFAULT 0 NOT NULL,
	"answer_kind" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"helpful" boolean,
	"feedback_at" timestamp with time zone,
	"review_status" text DEFAULT 'none' NOT NULL,
	"resolved_answer_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_message_role_chk" CHECK ("assistant_message"."role" in ('user','assistant')),
	CONSTRAINT "assistant_message_kind_chk" CHECK ((("assistant_message"."role" = 'assistant') = ("assistant_message"."answer_kind" is not null)) and ("assistant_message"."answer_kind" is null or "assistant_message"."answer_kind" in ('answered','not_in_guides','refused','truncated','failed'))),
	CONSTRAINT "assistant_message_feedback_chk" CHECK ("assistant_message"."helpful" is null or "assistant_message"."role" = 'assistant'),
	CONSTRAINT "assistant_message_review_chk" CHECK ("assistant_message"."review_status" in ('none','open','dismissed','resolved'))
);
--> statement-breakpoint
CREATE TABLE "blog_draft_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week" text NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"topic_key" text,
	"status" text DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"post_id" uuid,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"created_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "blog_draft_run_trigger_chk" CHECK ("blog_draft_run"."trigger" in ('schedule','manual')),
	CONSTRAINT "blog_draft_run_status_chk" CHECK ("blog_draft_run"."status" in ('running','drafted','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "guide_progress" (
	"user_id" text NOT NULL,
	"guide_slug" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"passed_at" timestamp with time zone,
	"best_score" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_progress_user_id_guide_slug_pk" PRIMARY KEY("user_id","guide_slug"),
	CONSTRAINT "guide_progress_score_chk" CHECK ("guide_progress"."best_score" is null or "guide_progress"."best_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "guide_quiz_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"guide_slug" text NOT NULL,
	"quiz_version" text NOT NULL,
	"correct" integer NOT NULL,
	"total" integer NOT NULL,
	"passed" boolean NOT NULL,
	"answers" jsonb NOT NULL,
	"church_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_quiz_attempt_score_chk" CHECK ("guide_quiz_attempt"."total" > 0 and "guide_quiz_attempt"."correct" between 0 and "guide_quiz_attempt"."total")
);
--> statement-breakpoint
CREATE TABLE "pastor_booking_type" (
	"church_id" text NOT NULL,
	"pastor_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	CONSTRAINT "pastor_booking_type_pastor_id_type_id_pk" PRIMARY KEY("pastor_id","type_id")
);
--> statement-breakpoint
CREATE TABLE "pastor_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"pastor_id" uuid NOT NULL,
	"kind" "pastor_closure_kind" DEFAULT 'leave' NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pastor_closure_range_chk" CHECK ("pastor_closure"."ends_at" > "pastor_closure"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "pastor_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"pastor_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "pastor_hours_weekday_chk" CHECK ("pastor_hours"."weekday" between 0 and 6),
	CONSTRAINT "pastor_hours_range_chk" CHECK ("pastor_hours"."start_minute" >= 0 and "pastor_hours"."end_minute" <= 1440 and "pastor_hours"."start_minute" < "pastor_hours"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "pastor_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"is_bookable" boolean DEFAULT true NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_notice_hours" integer DEFAULT 12 NOT NULL,
	"max_advance_days" integer DEFAULT 30 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pastor_profile_slot_chk" CHECK ("pastor_profile"."slot_minutes" between 10 and 240),
	CONSTRAINT "pastor_profile_buffer_chk" CHECK ("pastor_profile"."buffer_minutes" between 0 and 240),
	CONSTRAINT "pastor_profile_notice_chk" CHECK ("pastor_profile"."min_notice_hours" between 0 and 720),
	CONSTRAINT "pastor_profile_advance_chk" CHECK ("pastor_profile"."max_advance_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "pastoral_appointment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"pastor_id" uuid,
	"pastor_name" text NOT NULL,
	"type_id" uuid,
	"type_name" text NOT NULL,
	"location" "pastoral_location" DEFAULT 'church' NOT NULL,
	"address" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"holds_until" timestamp with time zone NOT NULL,
	"status" "pastoral_appointment_status" DEFAULT 'pending' NOT NULL,
	"source" "pastoral_booking_source" DEFAULT 'staff' NOT NULL,
	"member_id" uuid,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"booker_name" text NOT NULL,
	"booker_phone" text,
	"booker_email" text,
	"locale" text,
	"topic" text,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"manage_token_hash" text,
	"remind_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"confirmation_outcome" text,
	"reminder_outcome" text,
	"rescheduled_from" timestamp with time zone,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pastoral_appointment_manageTokenHash_unique" UNIQUE("manage_token_hash"),
	CONSTRAINT "pastoral_appointment_range_chk" CHECK ("pastoral_appointment"."ends_at" > "pastoral_appointment"."starts_at" and "pastoral_appointment"."holds_until" >= "pastoral_appointment"."ends_at"),
	CONSTRAINT "pastoral_appointment_cancelled_by_chk" CHECK ("pastoral_appointment"."cancelled_by" is null or "pastoral_appointment"."cancelled_by" in ('booker', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "pastoral_booking_page" (
	"church_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"visibility" "pastoral_booking_visibility" DEFAULT 'public' NOT NULL,
	"title" text DEFAULT 'Book time with a pastor' NOT NULL,
	"intro" text DEFAULT 'Choose what you would like to talk about and a time that suits you. You will get a confirmation straight away.' NOT NULL,
	"email_booker" boolean DEFAULT true NOT NULL,
	"sms_booker" boolean DEFAULT false NOT NULL,
	"notify_pastor_by_email" boolean DEFAULT true NOT NULL,
	"reminder_lead_minutes" integer DEFAULT 1440 NOT NULL,
	"change_cutoff_hours" integer DEFAULT 2 NOT NULL,
	"max_upcoming_per_contact" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pastoral_booking_page_slug_unique" UNIQUE("slug"),
	CONSTRAINT "pastoral_booking_page_lead_chk" CHECK ("pastoral_booking_page"."reminder_lead_minutes" between 60 and 4320),
	CONSTRAINT "pastoral_booking_page_cutoff_chk" CHECK ("pastoral_booking_page"."change_cutoff_hours" between 0 and 168),
	CONSTRAINT "pastoral_booking_page_max_chk" CHECK ("pastoral_booking_page"."max_upcoming_per_contact" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "pastoral_booking_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer,
	"location" "pastoral_location" DEFAULT 'church' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pastoral_booking_type_duration_chk" CHECK ("pastoral_booking_type"."duration_minutes" is null or "pastoral_booking_type"."duration_minutes" between 10 and 480)
);
--> statement-breakpoint
CREATE TABLE "platform_certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"rank" "certification_rank" NOT NULL,
	"code" text NOT NULL,
	"holder_name" text NOT NULL,
	"active_weeks_at_issue" integer NOT NULL,
	"modules_at_issue" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_active_day" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"actions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_active_day_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "user_active_day_nonzero_chk" CHECK ("user_active_day"."pageviews" + "user_active_day"."actions" > 0)
);
--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN "source" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN "topic_key" text;--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN "ai_drafted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "sms_outcome" text;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "sms_detail" text;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "sms_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "email_outcome" text;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "email_detail" text;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "sms_outcome" text;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "sms_detail" text;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "sms_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "email_outcome" text;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "email_detail" text;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_run" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_church_setting" ADD CONSTRAINT "ai_church_setting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_church_setting" ADD CONSTRAINT "ai_church_setting_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_call_id_ai_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."ai_call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_reused_from_id_ai_summary_id_fk" FOREIGN KEY ("reused_from_id") REFERENCES "public"."ai_summary"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_answer" ADD CONSTRAINT "assistant_answer_source_message_id_assistant_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."assistant_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_answer" ADD CONSTRAINT "assistant_answer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_answer" ADD CONSTRAINT "assistant_answer_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_resolved_answer_id_assistant_answer_id_fk" FOREIGN KEY ("resolved_answer_id") REFERENCES "public"."assistant_answer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_draft_run" ADD CONSTRAINT "blog_draft_run_post_id_blog_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_draft_run" ADD CONSTRAINT "blog_draft_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_progress" ADD CONSTRAINT "guide_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_quiz_attempt" ADD CONSTRAINT "guide_quiz_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_quiz_attempt" ADD CONSTRAINT "guide_quiz_attempt_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_booking_type" ADD CONSTRAINT "pastor_booking_type_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_booking_type" ADD CONSTRAINT "pastor_booking_type_pastor_id_pastor_profile_id_fk" FOREIGN KEY ("pastor_id") REFERENCES "public"."pastor_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_booking_type" ADD CONSTRAINT "pastor_booking_type_type_id_pastoral_booking_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."pastoral_booking_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_closure" ADD CONSTRAINT "pastor_closure_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_closure" ADD CONSTRAINT "pastor_closure_pastor_id_pastor_profile_id_fk" FOREIGN KEY ("pastor_id") REFERENCES "public"."pastor_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_closure" ADD CONSTRAINT "pastor_closure_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_hours" ADD CONSTRAINT "pastor_hours_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_hours" ADD CONSTRAINT "pastor_hours_pastor_id_pastor_profile_id_fk" FOREIGN KEY ("pastor_id") REFERENCES "public"."pastor_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_profile" ADD CONSTRAINT "pastor_profile_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_profile" ADD CONSTRAINT "pastor_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastor_profile" ADD CONSTRAINT "pastor_profile_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_pastor_id_pastor_profile_id_fk" FOREIGN KEY ("pastor_id") REFERENCES "public"."pastor_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_type_id_pastoral_booking_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."pastoral_booking_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_booking_page" ADD CONSTRAINT "pastoral_booking_page_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_booking_type" ADD CONSTRAINT "pastoral_booking_type_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pastoral_booking_type" ADD CONSTRAINT "pastoral_booking_type_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_certificate" ADD CONSTRAINT "platform_certificate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_active_day" ADD CONSTRAINT "user_active_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_budget_month_subject_idx" ON "ai_budget_month" USING btree ("month","subject");--> statement-breakpoint
CREATE INDEX "ai_call_church_idx" ON "ai_call" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_call_created_idx" ON "ai_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_call_month_idx" ON "ai_call" USING btree ("budget_month","church_id");--> statement-breakpoint
CREATE INDEX "ai_call_open_idx" ON "ai_call" USING btree ("created_at") WHERE "ai_call"."status" = 'reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_summary_subject_day_idx" ON "ai_summary" USING btree ("subject","day");--> statement-breakpoint
CREATE INDEX "assistant_answer_status_idx" ON "assistant_answer" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_conversation_church_idx" ON "assistant_conversation" USING btree ("church_id","last_message_at");--> statement-breakpoint
CREATE INDEX "assistant_conversation_user_idx" ON "assistant_conversation" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "assistant_conversation_last_idx" ON "assistant_conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "assistant_message_conversation_idx" ON "assistant_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_message_user_idx" ON "assistant_message" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_message_church_idx" ON "assistant_message" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_message_review_idx" ON "assistant_message" USING btree ("created_at") WHERE "assistant_message"."review_status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "blog_draft_run_week_schedule_unique" ON "blog_draft_run" USING btree ("week") WHERE "blog_draft_run"."trigger" = 'schedule';--> statement-breakpoint
CREATE INDEX "blog_draft_run_topic_idx" ON "blog_draft_run" USING btree ("topic_key","status");--> statement-breakpoint
CREATE INDEX "blog_draft_run_started_idx" ON "blog_draft_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "guide_quiz_attempt_user_idx" ON "guide_quiz_attempt" USING btree ("user_id","guide_slug","created_at");--> statement-breakpoint
CREATE INDEX "pastor_booking_type_type_idx" ON "pastor_booking_type" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "pastor_closure_church_idx" ON "pastor_closure" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "pastor_closure_pastor_time_idx" ON "pastor_closure" USING btree ("pastor_id","starts_at");--> statement-breakpoint
CREATE INDEX "pastor_hours_pastor_idx" ON "pastor_hours" USING btree ("pastor_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "pastor_profile_church_user_idx" ON "pastor_profile" USING btree ("church_id","user_id");--> statement-breakpoint
CREATE INDEX "pastor_profile_church_idx" ON "pastor_profile" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "pastoral_appointment_church_idx" ON "pastoral_appointment" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "pastoral_appointment_pastor_time_idx" ON "pastoral_appointment" USING btree ("pastor_id","starts_at");--> statement-breakpoint
CREATE INDEX "pastoral_appointment_church_status_idx" ON "pastoral_appointment" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "pastoral_appointment_phone_idx" ON "pastoral_appointment" USING btree ("church_id","booker_phone");--> statement-breakpoint
CREATE INDEX "pastoral_appointment_email_idx" ON "pastoral_appointment" USING btree ("church_id","booker_email");--> statement-breakpoint
CREATE INDEX "pastoral_appointment_remind_idx" ON "pastoral_appointment" USING btree ("remind_at") WHERE "pastoral_appointment"."status" = 'confirmed' and "pastoral_appointment"."reminder_sent_at" is null;--> statement-breakpoint
CREATE INDEX "pastoral_booking_type_church_idx" ON "pastoral_booking_type" USING btree ("church_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "pastoral_booking_type_name_idx" ON "pastoral_booking_type" USING btree ("church_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_certificate_user_rank_idx" ON "platform_certificate" USING btree ("user_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_certificate_code_idx" ON "platform_certificate" USING btree ("code");--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_source_status_idx" ON "blog_post" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "pledge_reminder_run_sms_retry_idx" ON "pledge_reminder_run" USING btree ("updated_at") WHERE sms_outcome in ('failed', 'pending');--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_source_chk" CHECK ("blog_post"."source" in ('human','ai'));--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD CONSTRAINT "pledge_reminder_run_sms_outcome_chk" CHECK ("pledge_reminder_run"."sms_outcome" is null or "pledge_reminder_run"."sms_outcome" in ('pending','sent','queued','failed','skipped'));--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD CONSTRAINT "pledge_reminder_run_email_outcome_chk" CHECK ("pledge_reminder_run"."email_outcome" is null or "pledge_reminder_run"."email_outcome" in ('pending','sent','failed','skipped'));--> statement-breakpoint
ALTER TABLE "pledge_reminder_run" ADD CONSTRAINT "pledge_reminder_run_sms_attempts_chk" CHECK ("pledge_reminder_run"."sms_attempts" between 0 and 3);--> statement-breakpoint
ALTER TABLE "reminder_run" ADD CONSTRAINT "reminder_run_sms_outcome_chk" CHECK ("reminder_run"."sms_outcome" is null or "reminder_run"."sms_outcome" in ('pending','sent','queued','failed','skipped'));--> statement-breakpoint
ALTER TABLE "reminder_run" ADD CONSTRAINT "reminder_run_email_outcome_chk" CHECK ("reminder_run"."email_outcome" is null or "reminder_run"."email_outcome" in ('pending','sent','failed','skipped'));--> statement-breakpoint
ALTER TABLE "reminder_run" ADD CONSTRAINT "reminder_run_sms_attempts_chk" CHECK ("reminder_run"."sms_attempts" between 0 and 3);--> statement-breakpoint
-- Hand-written below this line: what drizzle cannot express.
-- The database's own refusal of a double booking: two appointments that hold a
-- slot (pending or confirmed) may not overlap for one pastor, buffer included.
-- Half-open, so one may start exactly when the other's buffer ends.
-- lockPastorForBooking is the application's half; this is the floor.
-- isBookingOverlapViolation reads its SQLSTATE 23P01. See pastoral.db-check.ts.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "pastoral_appointment" ADD CONSTRAINT "pastoral_appointment_no_overlap"
  EXCLUDE USING gist (
    "pastor_id" WITH =,
    tstzrange("starts_at", "holds_until", '[)') WITH &&
  ) WHERE ("status" in ('pending', 'confirmed'));
