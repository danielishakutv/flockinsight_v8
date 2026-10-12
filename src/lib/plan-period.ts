/**
 * Where a church's renewal date lands after it pays. Pure and client-safe, so
 * the billing screen can tell a church what a payment will do with the SAME
 * arithmetic the server then applies.
 *
 * Three rules, each of which used to be wrong:
 *
 * 1. PAID TIME IS NEVER LOST. Renewing early — the same plan, or switching
 *    monthly to annual — extends from the current renewal date, not from
 *    today.
 *
 * 2. A FREE TRIAL IS NEVER LOST EITHER. The billing banner says "pick a plan
 *    any time to continue after the trial", so paid months start when the
 *    trial ends. Before, a church paying a month on its second Sunday had the
 *    month start that day and end before the trial would have — it paid and
 *    gained nothing.
 *
 * 3. CHANGING TIER CONVERTS THE REMAINING PAID TIME AT ITS VALUE, not day for
 *    day. Carrying days across let a church pay Starter for a year and then
 *    one month of Pro, and own Pro for thirteen months; and a mis-tapped
 *    downgrade turned a paid year of Pro into a year of Starter. So what is
 *    left is valued at the old plan's monthly price and re-bought at the new
 *    one's: twelve months of ₦5,000 Starter becomes about 2.4 months of
 *    ₦25,000 Pro, and twelve months of Pro becomes about five years of
 *    Starter. Nobody gains, nobody forfeits, and the rule fits in one
 *    sentence on the plan card.
 *
 * The trial is not converted: it is free on every tier, so it simply runs to
 * its end whatever plan the church picks.
 */

const DAY_MS = 86_400_000;

export type PeriodInput = {
  now: Date;
  /** The plan the church is on now. */
  currentPlan: string;
  /** Its current paid-through date, if any. */
  renewsAt: Date | string | null;
  /** The end of its free trial, if any. */
  trialEndsAt: Date | string | null;
  /** The plan being paid for. */
  plan: string;
  /** How many months this payment buys. */
  months: number;
  /**
   * Monthly prices (after the church's discount) of the current and the new
   * plan. Null is a custom price (Enterprise) — there is nothing to value it
   * at, so its days carry across one for one.
   */
  currentMonthly: number | null;
  newMonthly: number | null;
  /**
   * Off for a superadmin grant: an operator who types "12 months of Pro"
   * means exactly that, and has already decided what the old time was worth.
   */
  convertRemaining: boolean;
};

export type PeriodResult = {
  renewsAt: Date;
  /** Set when remaining paid time was revalued onto a different tier. */
  conversion: {
    fromPlan: string;
    fromDays: number;
    toDays: number;
  } | null;
};

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * How many days of the new plan the remaining paid time is worth. Returns
 * the remaining time unchanged when there is no tier change or no basis for
 * a price ratio.
 */
export function convertRemainingMs(
  remainingMs: number,
  currentMonthly: number | null,
  newMonthly: number | null,
): number {
  if (remainingMs <= 0) return 0;
  // Custom on either side: no price to value it at. Keep the days.
  if (currentMonthly === null || newMonthly === null) return remainingMs;
  // Moving onto a free tier: its days cost nothing, keep them all.
  if (newMonthly <= 0) return remainingMs;
  // Free time (a free tier, a 100% discount) is worth nothing on a priced one.
  if (currentMonthly <= 0) return 0;
  return Math.round(remainingMs * (currentMonthly / newMonthly));
}

export function nextRenewal(input: PeriodInput): PeriodResult {
  const { now } = input;
  const renews = toDate(input.renewsAt);
  const trialEnds = toDate(input.trialEndsAt);

  const remainingPaid = renews ? Math.max(0, renews.getTime() - now.getTime()) : 0;
  const changingTier = input.plan !== input.currentPlan;

  let carried = remainingPaid;
  let conversion: PeriodResult["conversion"] = null;
  if (changingTier && remainingPaid > 0 && input.convertRemaining) {
    carried = convertRemainingMs(remainingPaid, input.currentMonthly, input.newMonthly);
    const fromDays = Math.round(remainingPaid / DAY_MS);
    const toDays = Math.round(carried / DAY_MS);
    if (fromDays !== toDays)
      conversion = { fromPlan: input.currentPlan, fromDays, toDays };
  }

  const remainingTrial = trialEnds ? Math.max(0, trialEnds.getTime() - now.getTime()) : 0;
  // Paid time and the trial do not stack — a trial already running out under
  // a paid period is covered by it. Start from whichever reaches further.
  const base = new Date(now.getTime() + Math.max(carried, remainingTrial));
  const next = new Date(base);
  next.setMonth(next.getMonth() + Math.max(0, Math.round(input.months)));
  return { renewsAt: next, conversion };
}

/** "340 days of Starter become 68 days of Pro" — for a payment note or a card. */
export function conversionSentence(
  c: NonNullable<PeriodResult["conversion"]>,
  toPlanName: string,
  fromPlanName: string,
): string {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  return `Your remaining ${days(c.fromDays)} of ${fromPlanName} become ${days(c.toDays)} of ${toPlanName}`;
}

/**
 * Undo a voided payment's extension: the renewal date moves back by the
 * months that payment bought, and never earlier than now.
 *
 * Never earlier than now, because a renewal date in the past and one at this
 * instant mean the same thing to the paywall (the plan has lapsed) — and
 * winding further back would also eat into time some OTHER payment bought,
 * which a void of this one has no business touching. If the church's other
 * payments still cover a later date, subtracting only this payment's months
 * leaves exactly that date.
 *
 * It does not change the TIER. A payment that switched plans cannot be
 * un-switched from its row alone, and the paywall already does the right
 * thing once the date passes.
 */
export function rollbackRenewal(
  renewsAt: Date | string | null,
  months: number,
  now: Date,
): Date | null {
  const renews = toDate(renewsAt);
  if (!renews) return null;
  const back = new Date(renews);
  back.setMonth(back.getMonth() - Math.max(0, Math.round(months)));
  return back.getTime() > now.getTime() ? back : new Date(now);
}
