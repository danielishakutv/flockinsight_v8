-- Which browser a participant is, as that browser remembers itself.
--
-- A peer id is per join; this is per browser profile, kept in local storage.
-- A tab that crashed and a tab that was reloaded are then the same device
-- coming back rather than a second person in the room, and joining retires
-- whatever this device was already doing here. That is what stops one person
-- appearing three times in a roster.
--
-- Nullable on purpose: a browser in private mode cannot keep an id, and
-- refusing those people entry would be a far worse bug than a duplicate tile.
ALTER TABLE "meeting_participant" ADD COLUMN IF NOT EXISTS "device_id" text;

-- Every join reads this, so it sits on the critical path of walking into a
-- room -- including the fifty people who arrive in the minute a service starts.
CREATE INDEX IF NOT EXISTS "meeting_participant_device_idx"
  ON "meeting_participant" ("meeting_id", "device_id");
