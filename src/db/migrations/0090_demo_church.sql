CREATE TABLE "demo_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"church_id" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"phone" text,
	"verified_at" timestamp with time zone,
	"otp_id" uuid,
	"lead_id" uuid,
	"ip" text,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_session_church_idx" ON "demo_session" USING btree ("church_id","started_at");--> statement-breakpoint
CREATE INDEX "demo_session_email_idx" ON "demo_session" USING btree ("email");