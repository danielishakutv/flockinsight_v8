CREATE TYPE "public"."audit_scope" AS ENUM('platform', 'church');--> statement-breakpoint
CREATE TYPE "public"."audit_severity" AS ENUM('info', 'notice', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."meeting_access" AS ENUM('open', 'passcode', 'members');--> statement-breakpoint
CREATE TYPE "public"."meeting_quality" AS ENUM('good', 'fair', 'poor', 'lost');--> statement-breakpoint
CREATE TYPE "public"."meeting_role" AS ENUM('host', 'cohost', 'speaker', 'attendee');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'live', 'ended', 'cancelled');--> statement-breakpoint
CREATE TABLE "meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'meeting' NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"host_user_id" text,
	"access" "meeting_access" DEFAULT 'open' NOT NULL,
	"passcode" text,
	"lobby" boolean DEFAULT false NOT NULL,
	"max_participants" integer DEFAULT 12 NOT NULL,
	"mute_on_entry" boolean DEFAULT true NOT NULL,
	"camera_off_on_entry" boolean DEFAULT false NOT NULL,
	"allow_chat" boolean DEFAULT true NOT NULL,
	"allow_reactions" boolean DEFAULT true NOT NULL,
	"allow_screen_share" boolean DEFAULT true NOT NULL,
	"allow_recording" boolean DEFAULT true NOT NULL,
	"low_data_default" boolean DEFAULT false NOT NULL,
	"record_attendance" boolean DEFAULT false NOT NULL,
	"service_id" uuid,
	"group_id" uuid,
	"stage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"peak_participants" integer DEFAULT 0 NOT NULL,
	"total_joins" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"participant_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"peer_id" text NOT NULL,
	"secret" text NOT NULL,
	"user_id" text,
	"member_id" uuid,
	"display_name" text NOT NULL,
	"role" "meeting_role" DEFAULT 'attendee' NOT NULL,
	"admitted" boolean DEFAULT true NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"mic_on" boolean DEFAULT false NOT NULL,
	"camera_on" boolean DEFAULT false NOT NULL,
	"sharing" boolean DEFAULT false NOT NULL,
	"hand_raised" boolean DEFAULT false NOT NULL,
	"low_data" boolean DEFAULT false NOT NULL,
	"quality" "meeting_quality" DEFAULT 'good' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "meeting_recording" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"media_id" uuid,
	"title" text NOT NULL,
	"mode" text DEFAULT 'video' NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"url" text,
	"error" text,
	"started_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_signal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"from_peer" text NOT NULL,
	"to_peer" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripture_verse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"translation" text NOT NULL,
	"body" text NOT NULL,
	"verses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "scope" "audit_scope" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "church_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_email" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "via_impersonation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "module" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "severity" "audit_severity" DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "target_label" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_group_id_church_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."church_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_message" ADD CONSTRAINT "meeting_message_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_message" ADD CONSTRAINT "meeting_message_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_message" ADD CONSTRAINT "meeting_message_participant_id_meeting_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."meeting_participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participant" ADD CONSTRAINT "meeting_participant_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participant" ADD CONSTRAINT "meeting_participant_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participant" ADD CONSTRAINT "meeting_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participant" ADD CONSTRAINT "meeting_participant_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_recording" ADD CONSTRAINT "meeting_recording_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_recording" ADD CONSTRAINT "meeting_recording_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_recording" ADD CONSTRAINT "meeting_recording_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_recording" ADD CONSTRAINT "meeting_recording_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_signal" ADD CONSTRAINT "meeting_signal_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_code_unique" ON "meeting" USING btree ("code");--> statement-breakpoint
CREATE INDEX "meeting_church_idx" ON "meeting" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "meeting_church_status_idx" ON "meeting" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "meeting_church_scheduled_idx" ON "meeting" USING btree ("church_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "meeting_message_meeting_idx" ON "meeting_message" USING btree ("meeting_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_participant_peer_unique" ON "meeting_participant" USING btree ("meeting_id","peer_id");--> statement-breakpoint
CREATE INDEX "meeting_participant_meeting_idx" ON "meeting_participant" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_participant_live_idx" ON "meeting_participant" USING btree ("meeting_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "meeting_participant_church_idx" ON "meeting_participant" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "meeting_recording_meeting_idx" ON "meeting_recording" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_recording_church_idx" ON "meeting_recording" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "meeting_signal_meeting_id_idx" ON "meeting_signal" USING btree ("meeting_id","id");--> statement-breakpoint
CREATE INDEX "meeting_signal_created_idx" ON "meeting_signal" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scripture_verse_unique" ON "scripture_verse" USING btree ("reference","translation");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_church_created_idx" ON "audit_log" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_scope_created_idx" ON "audit_log" USING btree ("scope","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_module_idx" ON "audit_log" USING btree ("module");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_log" USING btree ("target_type","target_id");