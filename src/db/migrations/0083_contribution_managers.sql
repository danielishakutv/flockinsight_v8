CREATE TYPE "public"."contribution_manager_role" AS ENUM('owner', 'coadmin');--> statement-breakpoint
CREATE TABLE "contribution_manager" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "contribution_manager_role" DEFAULT 'coadmin' NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contribution_manager" ADD CONSTRAINT "contribution_manager_contribution_id_contribution_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contribution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_manager" ADD CONSTRAINT "contribution_manager_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_manager" ADD CONSTRAINT "contribution_manager_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_manager" ADD CONSTRAINT "contribution_manager_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_manager_pot_idx" ON "contribution_manager" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "contribution_manager_user_idx" ON "contribution_manager" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_manager_unique" ON "contribution_manager" USING btree ("contribution_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_manager_one_owner" ON "contribution_manager" USING btree ("contribution_id") WHERE "contribution_manager"."role" = 'owner';--> statement-breakpoint
/*
 * Every collection that already exists keeps the person who started it.
 *
 * Without this, the day this ships every existing collection shows "nobody runs
 * this" — which is both untrue and alarming, and would make the owner of a live
 * levy think they had lost access to it. `created_by` is exactly who was running
 * it, so it is who the row should name.
 *
 * `where created_by is not null` because a collection seeded or imported without
 * a creator has nobody to name, and inventing one would be worse than the blank.
 * `on conflict do nothing` so re-running the migration is a no-op rather than a
 * duplicate-key failure.
 */
INSERT INTO "contribution_manager" ("contribution_id", "church_id", "user_id", "role")
SELECT "id", "church_id", "created_by", 'owner'
FROM "contribution"
WHERE "created_by" IS NOT NULL
ON CONFLICT DO NOTHING;
