-- A decided withdrawal stays decided, whoever writes to the row.
--
-- decidePayout holds the state machine under a row lock (PAYOUT_TRANSITIONS in
-- lib/partners-shared.ts). This is the same rule held by Postgres, so a script,
-- a console session or a future code path that updates the row directly cannot
-- reopen a payout whose money has already gone, or un-reject one whose earnings
-- were handed back. The allowed moves are exactly PAYOUT_TRANSITIONS:
--
--   requested -> approved | paid | rejected
--   approved  -> paid | rejected
--
-- Paid and rejected are final. An update that leaves the status alone (a typo
-- in the reference corrected) is untouched. partners.db-check.ts proves it.
CREATE OR REPLACE FUNCTION partner_payout_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'requested' AND NEW.status IN ('approved', 'paid', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'partner_payout % is %, and cannot become %',
      OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS partner_payout_final ON "partner_payout";--> statement-breakpoint
CREATE TRIGGER partner_payout_final
  BEFORE UPDATE OF "status" ON "partner_payout"
  FOR EACH ROW EXECUTE FUNCTION partner_payout_final();
