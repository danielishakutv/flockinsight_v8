import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { church } from "@/db/schema";
import { computeStanding } from "@/lib/trial";

/**
 * May a scheduled job act FOR this church — send its members a birthday
 * greeting, a service reminder, a devotional?
 *
 * The paywall is `computeStanding` (lib/trial.ts), applied in the app layout:
 * a church whose trial has run out, with no paid plan and no live waiver, sees
 * the "keep going" screen instead of its dashboard. The crons never asked. So
 * a church that stopped paying kept every automation it had switched on — the
 * platform paying Resend for its email, its SMS wallet charged for messages it
 * could no longer see or turn off, because the settings that control them are
 * behind the same gate.
 *
 * This is the question the crons now ask, with ONE definition: the JS form
 * calls `computeStanding` itself, and the SQL form below is checked against it
 * on the same fixtures (church-standing-fixtures.ts) in
 * `church-standing.db-check.ts`, so the two cannot
 * quietly disagree about a grandfathered church, a waiver with an end date or
 * a plan that renews tomorrow.
 *
 * NOT for messages from the PLATFORM to a church's owner — trial reminders,
 * "come back" nudges, platform broadcasts. Those are how a lapsed church hears
 * it has lapsed, and gating them would be gating the way out.
 *
 * The demonstration church is never paused, the same as it is never shown the
 * paywall: it has no trial and pays for nothing by design.
 */

/** The church columns the answer depends on. Select these, pass the row. */
export const standingColumns = {
  isDemo: church.isDemo,
  plan: church.plan,
  paymentWaived: church.paymentWaived,
  paymentWaivedUntil: church.paymentWaivedUntil,
  planRenewsAt: church.planRenewsAt,
  trialEndsAt: church.trialEndsAt,
};

export type StandingRow = {
  isDemo?: boolean | null;
  plan?: string | null;
  paymentWaived?: boolean | null;
  paymentWaivedUntil?: Date | string | null;
  planRenewsAt?: Date | string | null;
  trialEndsAt?: Date | string | null;
};

/** True when the church's automations should hold until it pays. */
export function automationPaused(c: StandingRow, now: Date = new Date()): boolean {
  if (c.isDemo) return false;
  return computeStanding(c, now).gated;
}

type Operand = SQLWrapper;

/**
 * The same rule as a WHERE fragment, for queries that must not even fetch a
 * paused church's rows — the devotionals cron takes 25 at a time, and a
 * backlog belonging to lapsed churches would otherwise fill every batch and
 * starve the churches that pay.
 *
 * Built from column references, so it is qualified (`"church"."trial_ends_at"`)
 * whenever the query joins — and every caller here joins `church`. Do NOT drop
 * it into a correlated subquery over another table; see the raw-SQL qualifier
 * trap in AGENTS.md.
 *
 * `now` is a parameter rather than SQL `now()` so the database and
 * `computeStanding` judge the same instant.
 *
 * Wrapped in coalesce: `null > $now` is NULL, and a NULL in a select list
 * would read as "unknown" rather than "no".
 */
export function inGoodStandingSql(
  now: Date = new Date(),
  cols: Record<keyof typeof standingColumns, Operand> = standingColumns,
): SQL {
  const at = sql`${now.toISOString()}::timestamptz`;
  /*
   * Line by line, the order computeStanding asks in:
   *   a live waiver (none, or an end date still ahead);
   *   a paid period still running;
   *   no trial date, and either nothing was ever paid (grandfathered) or the
   *     church is on Enterprise, whose lapsed contract is a conversation and
   *     never the paywall;
   *   a trial still running.
   * Anything else is gated — including a church with no trial whose paid
   * period has run out, which computeStanding now gates too.
   */
  return sql`coalesce((
    ${cols.isDemo}
    or (${cols.paymentWaived} and (${cols.paymentWaivedUntil} is null or ${cols.paymentWaivedUntil} > ${at}))
    or ${cols.planRenewsAt} > ${at}
    or (${cols.trialEndsAt} is null and (${cols.planRenewsAt} is null or ${cols.plan} = 'enterprise'))
    or ${cols.trialEndsAt} > ${at}
  ), false)`;
}
