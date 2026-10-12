import type { StandingRow } from "@/lib/church-standing";

/**
 * Every shape of church the paywall distinguishes, relative to `now`.
 *
 * Shared by church-standing.test.ts (the JS rule against computeStanding) and
 * church-standing.db-check.ts (the SQL twin against computeStanding, in a real
 * Postgres), so the two are judged on exactly the same churches. A case added
 * here is checked in both places.
 */
export function standingFixtures(now: Date): { name: string; row: StandingRow }[] {
  const day = 86_400_000;
  const past = new Date(now.getTime() - 3 * day);
  const future = new Date(now.getTime() + 3 * day);
  return [
    { name: "grandfathered (no trial set)", row: { trialEndsAt: null } },
    { name: "still trialing", row: { trialEndsAt: future } },
    { name: "trial over, never paid", row: { trialEndsAt: past } },
    { name: "trial over, plan paid ahead", row: { trialEndsAt: past, planRenewsAt: future } },
    { name: "trial over, plan lapsed", row: { trialEndsAt: past, planRenewsAt: past } },
    { name: "no trial, plan paid ahead", row: { trialEndsAt: null, planRenewsAt: future } },
    {
      name: "no trial, plan lapsed",
      row: { trialEndsAt: null, planRenewsAt: past, plan: "growth" },
    },
    {
      name: "no trial, enterprise contract lapsed",
      row: { trialEndsAt: null, planRenewsAt: past, plan: "enterprise" },
    },
    { name: "comped indefinitely", row: { trialEndsAt: past, paymentWaived: true } },
    {
      name: "comp running",
      row: { trialEndsAt: past, paymentWaived: true, paymentWaivedUntil: future },
    },
    {
      name: "comp ended",
      row: { trialEndsAt: past, paymentWaived: true, paymentWaivedUntil: past },
    },
    {
      name: "date on a comp that was switched off",
      row: { trialEndsAt: past, paymentWaived: false, paymentWaivedUntil: future },
    },
    // The JSON round trip of an unstable_cache hit hands back strings, not Dates.
    { name: "dates as strings", row: { trialEndsAt: past.toISOString() } },
  ];
}
