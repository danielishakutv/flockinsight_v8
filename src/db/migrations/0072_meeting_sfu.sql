-- How media travels in a room, and where each participant publishes it.
--
-- `transport` is fixed for the life of a meeting: everyone in a room must use
-- the same one, because a mesh peer and an SFU peer cannot see each other.
-- Existing meetings stay on mesh, which is what they were built as.
ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "transport" text NOT NULL DEFAULT 'mesh';

-- A participant's publisher session on the SFU. Everybody else addresses their
-- media as (sfu_session_id, track name), and the track names are fixed, so this
-- one column is enough to find anyone's camera.
ALTER TABLE "meeting_participant" ADD COLUMN IF NOT EXISTS "sfu_session_id" text;
