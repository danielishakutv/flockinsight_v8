-- Livestreaming: a broadcast, which is deliberately not a meeting.
--
-- Trimmed by hand. `drizzle-kit generate` diffs against its last snapshot and
-- migrations 0070-0073 were written by hand, so the generated file also carried
-- statements for columns that already exist. Those are removed; the snapshot
-- this generate wrote is complete, so later generates diff correctly.

CREATE TABLE "livestream" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"input_uid" text,
	"whip_url" text,
	"whep_url" text,
	"rtmp_url" text,
	"rtmp_key" text,
	"hls_url" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"allow_chat" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"total_views" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "livestream_output" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"livestream_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"label" text NOT NULL,
	"platform" text DEFAULT 'custom' NOT NULL,
	"url" text NOT NULL,
	"output_uid" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "livestream" ADD CONSTRAINT "livestream_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestream" ADD CONSTRAINT "livestream_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestream_output" ADD CONSTRAINT "livestream_output_livestream_id_livestream_id_fk" FOREIGN KEY ("livestream_id") REFERENCES "public"."livestream"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestream_output" ADD CONSTRAINT "livestream_output_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "livestream_slug_unique" ON "livestream" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "livestream_church_idx" ON "livestream" USING btree ("church_id");
--> statement-breakpoint
CREATE INDEX "livestream_church_status_idx" ON "livestream" USING btree ("church_id","status");
--> statement-breakpoint
CREATE INDEX "livestream_output_stream_idx" ON "livestream_output" USING btree ("livestream_id");
--> statement-breakpoint
CREATE INDEX "livestream_output_church_idx" ON "livestream_output" USING btree ("church_id");
