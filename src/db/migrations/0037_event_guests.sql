CREATE TABLE "event_guest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'Guest' NOT NULL,
	"email" text,
	"phone" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_guest" ADD CONSTRAINT "event_guest_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_guest" ADD CONSTRAINT "event_guest_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_guest_event_idx" ON "event_guest" USING btree ("event_id");