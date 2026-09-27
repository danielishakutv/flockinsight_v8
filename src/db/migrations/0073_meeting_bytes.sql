-- What each participant's connection actually moved.
--
-- Measured rather than estimated: the client already samples getStats for the
-- quality pill, so the true figures are to hand. Estimating from a bitrate
-- ladder would be wrong exactly when it mattered, because a bad connection
-- sends less and a spotlight sends more.
--
-- bytes_received is the one that costs money: Cloudflare bills egress from its
-- edge to a client, so this column summed over a month IS the bill.
ALTER TABLE "meeting_participant" ADD COLUMN IF NOT EXISTS "bytes_received" bigint NOT NULL DEFAULT 0;
ALTER TABLE "meeting_participant" ADD COLUMN IF NOT EXISTS "bytes_sent" bigint NOT NULL DEFAULT 0;

-- The dashboard asks "how much this month", which is a scan by date across
-- every church. Without this it is a sequential scan of every participant row
-- that has ever existed.
CREATE INDEX IF NOT EXISTS "meeting_participant_billing_idx"
  ON "meeting_participant" ("joined_at")
  WHERE "bytes_received" > 0;
