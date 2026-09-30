-- Two lookups that every signed-in page runs, on a table with no index but its
-- primary key. IF NOT EXISTS because a migration that aborts a deploy over an
-- index that is already there is a worse outcome than a no-op; the snapshot
-- content is identical either way, so this does not drift from drizzle's view.
CREATE INDEX IF NOT EXISTS "staff_org_user_idx" ON "staff" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_user_idx" ON "staff" USING btree ("user_id");
