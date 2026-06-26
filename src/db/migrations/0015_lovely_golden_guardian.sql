CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"mime" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "handle" text;--> statement-breakpoint
UPDATE "church" SET "handle" = "slug" WHERE "handle" IS NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "public_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "denomination" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "cover_url" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "address_text" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "landmarks" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "public_phone" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "public_email" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "socials" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_church_idx" ON "media" USING btree ("church_id");--> statement-breakpoint
ALTER TABLE "church" ADD CONSTRAINT "church_handle_unique" UNIQUE("handle");