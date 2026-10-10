CREATE TABLE "branch_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hq_church_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'Group' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church" ADD COLUMN "branch_group_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_group" ADD CONSTRAINT "branch_group_hq_church_id_church_id_fk" FOREIGN KEY ("hq_church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_group" ADD CONSTRAINT "branch_group_parent_id_branch_group_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."branch_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_group" ADD CONSTRAINT "branch_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_group_hq_idx" ON "branch_group" USING btree ("hq_church_id");--> statement-breakpoint
CREATE INDEX "branch_group_parent_idx" ON "branch_group" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "church" ADD CONSTRAINT "church_branch_group_id_branch_group_id_fk" FOREIGN KEY ("branch_group_id") REFERENCES "public"."branch_group"("id") ON DELETE set null ON UPDATE no action;