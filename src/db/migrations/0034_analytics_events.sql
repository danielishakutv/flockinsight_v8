CREATE TABLE "analytics_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text,
	"user_id" text,
	"session_id" text,
	"kind" text DEFAULT 'pageview' NOT NULL,
	"name" text NOT NULL,
	"path" text,
	"plan" text,
	"role" text,
	"duration_ms" integer,
	"props" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_created_idx" ON "analytics_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_church_idx" ON "analytics_event" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_name_idx" ON "analytics_event" USING btree ("name");