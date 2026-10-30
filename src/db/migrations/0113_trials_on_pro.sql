-- Churches still inside their free Sundays get the trial the website promises:
-- every Pro feature (lib/trial.ts TRIAL_PLAN). New churches start on Pro at
-- sign-up; this moves the ones already mid-trial on the old Starter default.
--
-- Only a plain trial is touched: not a church that has paid (a running
-- planRenewsAt), not one comped by hand, not one on a custom plan, and not the
-- demo. Each of those had its plan chosen on purpose.
UPDATE "church"
SET "plan" = 'pro'
WHERE "plan" = 'starter'
  AND "custom_plan_id" IS NULL
  AND "is_demo" = false
  AND "payment_waived" = false
  AND "trial_ends_at" > now()
  AND ("plan_renews_at" IS NULL OR "plan_renews_at" <= now());
