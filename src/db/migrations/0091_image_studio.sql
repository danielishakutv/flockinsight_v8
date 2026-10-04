CREATE TABLE "image_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"logo_media_id" uuid,
	"config" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "image_preset" ADD CONSTRAINT "image_preset_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_preset" ADD CONSTRAINT "image_preset_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_preset" ADD CONSTRAINT "image_preset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_preset_church_idx" ON "image_preset" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "image_preset_name_idx" ON "image_preset" USING btree ("church_id","name");