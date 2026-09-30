-- Livestreams can come from somebody else's player.
--
-- "external" is the default because it is the one that costs nothing: the
-- church broadcasts to YouTube or Facebook as it probably already does, and we
-- show that player. Delivery is the only genuinely expensive part of streaming
-- and this way we are not doing it.
ALTER TABLE "livestream" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'external' NOT NULL;--> statement-breakpoint
ALTER TABLE "livestream" ADD COLUMN IF NOT EXISTS "external_url" text;--> statement-breakpoint
ALTER TABLE "livestream" ADD COLUMN IF NOT EXISTS "embed_url" text;--> statement-breakpoint

-- Anything already created went through Cloudflare, because that was the only
-- way there was. The column default would otherwise relabel those rows as
-- external and the page would look for an embed url they have never had.
UPDATE "livestream" SET "source" = 'cloudflare' WHERE "input_uid" IS NOT NULL;
