-- The roadmap board becomes a task list: five statuses collapse to two.
--
-- idea / planned / in_progress / shipped / parked  ->  todo / shipped
--
-- Nothing is thrown away. The old value of every row is copied into
-- `legacy_status` first, and the old enum type is RENAMED rather than dropped,
-- so this migration can be read backwards if the two-status list turns out to
-- be too blunt. Drop `roadmap_status_legacy` and the column by hand, later and
-- deliberately, once nobody wants them.

--> statement-breakpoint
ALTER TABLE "roadmap_item" ADD COLUMN IF NOT EXISTS "legacy_status" text;--> statement-breakpoint

UPDATE "roadmap_item"
   SET "legacy_status" = "status"::text
 WHERE "legacy_status" IS NULL;--> statement-breakpoint

ALTER TYPE "roadmap_status" RENAME TO "roadmap_status_legacy";--> statement-breakpoint

CREATE TYPE "roadmap_status" AS ENUM('todo', 'shipped');--> statement-breakpoint

-- The default has to go before the type can change: Postgres will not cast an
-- existing default of the old type.
ALTER TABLE "roadmap_item" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

-- Everything that was not shipped is still to do. Parked items come across as
-- to do rather than vanishing; `legacy_status` remembers that they were parked.
ALTER TABLE "roadmap_item"
  ALTER COLUMN "status" TYPE "roadmap_status"
  USING (
    CASE WHEN "status"::text = 'shipped' THEN 'shipped' ELSE 'todo' END
  )::"roadmap_status";--> statement-breakpoint

ALTER TABLE "roadmap_item" ALTER COLUMN "status" SET DEFAULT 'todo';--> statement-breakpoint

-- A shipped item has a date; a to-do one does not. Nothing enforced that
-- before, because the old `in_progress` and `parked` columns had no opinion.
-- It matters now: the list reads "shipped" off the status and prints
-- `shipped_at` beside it, and one of the two being wrong is invisible.
UPDATE "roadmap_item"
   SET "shipped_at" = COALESCE("shipped_at", "updated_at")
 WHERE "status" = 'shipped' AND "shipped_at" IS NULL;

-- Note what is deliberately NOT done here: a row that is now `todo` but still
-- carries a ship date and a frozen platform size is left exactly as it is.
-- That is an item somebody moved back out of Shipped, and keeping the stamps
-- is the existing rule — a mis-click must not be able to rewrite history with
-- today's larger numbers. `unshipRoadmapItem` is the one thing that clears
-- them, on purpose, and it still is.
