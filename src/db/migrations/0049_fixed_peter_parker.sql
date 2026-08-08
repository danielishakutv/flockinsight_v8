CREATE TABLE "cron_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"duration_ms" integer,
	"error" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "platform_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"severity" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"message" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	CONSTRAINT "platform_alert_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "termii_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance" numeric(14, 2),
	"currency" text,
	"ok" boolean NOT NULL,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cron_run_job_idx" ON "cron_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "platform_alert_state_idx" ON "platform_alert" USING btree ("state","severity");--> statement-breakpoint
CREATE INDEX "termii_snapshot_fetched_idx" ON "termii_snapshot" USING btree ("fetched_at");