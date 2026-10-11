-- One open withdrawal per Partner, enforced by the database rather than by a
-- read-then-write in application code that two taps can both pass.
--
-- Wrapped, because a bare CREATE UNIQUE INDEX aborts the whole migration if a
-- duplicate already exists — and a migration that fails takes the deploy with
-- it. If there is anything to clean up, this says so and leaves the data
-- alone; `requestPayout` holds the same rule with a row lock either way.
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(partner_id::text, ', ')
    INTO dupes
    FROM (
      SELECT partner_id
        FROM partner_payout
       WHERE status IN ('requested', 'approved')
       GROUP BY partner_id
      HAVING count(*) > 1
    ) d;

  IF dupes IS NOT NULL THEN
    RAISE WARNING 'partner_payout_one_open_idx NOT created: these partners already have more than one open payout: %. Settle or reject the extras, then create the index by hand.', dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "partner_payout_one_open_idx"
      ON "partner_payout" USING btree ("partner_id")
      WHERE status IN ('requested', 'approved');
  END IF;
END $$;
