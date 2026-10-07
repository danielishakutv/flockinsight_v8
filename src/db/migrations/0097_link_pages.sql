CREATE TABLE "link_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT 'Our links' NOT NULL,
	"tagline" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"style" text DEFAULT 'classic' NOT NULL,
	"layout" text DEFAULT 'buttons' NOT NULL,
	"show_logo" boolean DEFAULT true NOT NULL,
	"show_church_name" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_view_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_page_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "link_page_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"kind" text DEFAULT 'external' NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"last_click_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_page" ADD CONSTRAINT "link_page_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_page" ADD CONSTRAINT "link_page_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_page_item" ADD CONSTRAINT "link_page_item_page_id_link_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."link_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_page_item" ADD CONSTRAINT "link_page_item_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_page_church_idx" ON "link_page" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "link_page_status_idx" ON "link_page" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "link_page_item_page_idx" ON "link_page_item" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "link_page_item_church_idx" ON "link_page_item" USING btree ("church_id");