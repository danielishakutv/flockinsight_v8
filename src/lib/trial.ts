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
};

/**
 * Work out whether a church can keep using the app.
 * Good standing = payment waived, an active paid plan, still within trial, or
 * grandfathered (no trial set). Only an *expired* trial gates the app.
 */
export function computeStanding(
  c: {
    paymentWaived?: boolean | null;
    planRenewsAt?: Date | string | null;
    trialEndsAt?: Date | string | null;
  },
  now: Date = new Date(),
): Standing {
  const trialEnds = c.trialEndsAt ? new Date(c.trialEndsAt) : null;
  const renews = c.planRenewsAt ? new Date(c.planRenewsAt) : null;
  const daysLeft = trialEnds
    ? Math.max(0, Math.ceil((trialEnds.getTime() - now.getTime()) / 86_400_000))
    : null;

  if (c.paymentWaived)
    return { state: "waived", gated: false, trialEndsAt: trialEnds?.toISOString() ?? null, daysLeft };
  if (renews && renews.getTime() > now.getTime())
    return { state: "paid", gated: false, trialEndsAt: trialEnds?.toISOString() ?? null, daysLeft: null };
  if (!trialEnds) return { state: "none", gated: false, trialEndsAt: null, daysLeft: null };
  if (trialEnds.getTime() > now.getTime())
    return { state: "trialing", gated: false, trialEndsAt: trialEnds.toISOString(), daysLeft };
  return { state: "expired", gated: true, trialEndsAt: trialEnds.toISOString(), daysLeft: 0 };
}
