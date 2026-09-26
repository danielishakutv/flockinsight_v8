-- Who the host has put on the main screen for everyone.
--
-- On the meeting rather than in memory, so that somebody joining halfway
-- through the sermon is looking at the preacher like everybody else, and so a
-- restart does not silently scatter the room. Cleared when that person leaves:
-- a spotlight pointing at nobody is a black rectangle the room cannot fix.
ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "spotlight_peer_id" text;
