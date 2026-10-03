// Free-trial helpers ("first 7 Sundays free"). Pure + client-safe.

export const FREE_SUNDAYS = 7;
export const PROMO_TITLE = "Your first 7 Sundays are on us 🎉";
export const PROMO_BLURB =
  "New churches use FlockInsight completely free for their first 7 Sundays — no card required. After that, keep everything going from just a small monthly plan.";

/**
 * The end of the church's free trial: the last moment of the Nth upcoming
 * Sunday from `from` (a Sunday `from` counts as the 1st Sunday).
 */
export function trialEndDate(from: Date, sundays = FREE_SUNDAYS): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0 = Sunday
  const daysToFirstSunday = day === 0 ? 0 : 7 - day;
  const result = new Date(d);
  result.setDate(d.getDate() + daysToFirstSunday + (sundays - 1) * 7);
  result.setHours(23, 59, 59, 999);
  return result;
}

export type TrialState = "waived" | "paid" | "trialing" | "expired" | "none";

export type Standing = {
  state: TrialState;
  gated: boolean; // true = must pay to keep using the app
  trialEndsAt: string | null;
  daysLeft: number | null;
  /**
   * When the comp runs out, while it is still running. Null means either no
   * waiver or one with no end date — read it beside `state === "waived"`.
   */
  waiverEndsAt: string | null;
  /** Days until the waiver ends, for the "ends in 9 days" line. */
  waiverDaysLeft: number | null;
};

/** Whole days from `now` to `then`, never negative. */
function daysUntil(then: Date, now: Date): number {
  return Math.max(0, Math.ceil((then.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Is this church comped RIGHT NOW?
 *
 * A waiver can carry a deadline ("comp them for six months"), and an expired
 * one is not a waiver. The flag is deliberately left alone when the date
 * passes: it is the record that this church was comped, and clearing it on
 * read would lose that. So the date is checked here, on every read, rather
 * than by a cron job that has to remember to run.
 */
export function waiverActive(
  c: { paymentWaived?: boolean | null; paymentWaivedUntil?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!c.paymentWaived) return false;
  if (!c.paymentWaivedUntil) return true; // no end date = indefinite
  return new Date(c.paymentWaivedUntil).getTime() > now.getTime();
}

/**
 * Work out whether a church can keep using the app.
 * Good standing = payment waived (and not yet lapsed), an active paid plan,
 * still within trial, or grandfathered (no trial set). Only an *expired* trial
 * gates the app.
 */
export function computeStanding(
  c: {
    paymentWaived?: boolean | null;
    paymentWaivedUntil?: Date | string | null;
    planRenewsAt?: Date | string | null;
    trialEndsAt?: Date | string | null;
  },
  now: Date = new Date(),
): Standing {
  const trialEnds = c.trialEndsAt ? new Date(c.trialEndsAt) : null;
  const renews = c.planRenewsAt ? new Date(c.planRenewsAt) : null;
  const daysLeft = trialEnds ? daysUntil(trialEnds, now) : null;
  const waiverEnds = c.paymentWaivedUntil ? new Date(c.paymentWaivedUntil) : null;

  if (waiverActive(c, now))
    return {
      state: "waived",
      gated: false,
      trialEndsAt: trialEnds?.toISOString() ?? null,
      daysLeft,
      waiverEndsAt: waiverEnds?.toISOString() ?? null,
      waiverDaysLeft: waiverEnds ? daysUntil(waiverEnds, now) : null,
    };
  // Past here the waiver is either absent or lapsed, so the church follows the
  // ordinary rules — which is the whole point of giving a comp a deadline.
  const noWaiver = { waiverEndsAt: null, waiverDaysLeft: null } as const;

  if (renews && renews.getTime() > now.getTime())
    return {
      state: "paid",
      gated: false,
      trialEndsAt: trialEnds?.toISOString() ?? null,
      daysLeft: null,
      ...noWaiver,
    };
  if (!trialEnds)
    return { state: "none", gated: false, trialEndsAt: null, daysLeft: null, ...noWaiver };
  if (trialEnds.getTime() > now.getTime())
    return {
      state: "trialing",
      gated: false,
      trialEndsAt: trialEnds.toISOString(),
      daysLeft,
      ...noWaiver,
    };
  return {
    state: "expired",
    gated: true,
    trialEndsAt: trialEnds.toISOString(),
    daysLeft: 0,
    ...noWaiver,
  };
}

/** The choices a superadmin gets when comping a church. */
export const WAIVER_DURATIONS = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 9, label: "9 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: 0, label: "No end date" },
] as const;

export type WaiverMonths = (typeof WAIVER_DURATIONS)[number]["months"];

/**
 * The deadline for a comp of `months` months, or null for no end date.
 *
 * Calendar months, not 30-day blocks, so "6 months" lands on the same day of
 * the month — and clamps when that day does not exist (31 Aug + 6 months is
 * 28/29 Feb, not 3 March).
 */
export function waiverEndDate(months: number, from: Date = new Date()): Date | null {
  if (!months || months <= 0) return null;
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  d.setHours(23, 59, 59, 999);
  return d;
}
