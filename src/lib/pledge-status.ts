/**
 * Deciding whether a pledge counts as paid off.
 *
 * Kept apart from the database so the rule itself can be tested: it is the
 * part that decides whether a church sees a pledge as still outstanding.
 */

export type PledgeStatus = "active" | "completed" | "cancelled";

/**
 * Amounts are numeric(14,2) in Postgres but arrive as JavaScript numbers, so a
 * total summed from several payments can land a hair under the pledge —
 * 49999.999999999993 for what is really 50,000. Anything within half a cent is
 * the same money.
 */
const TOLERANCE = 0.005;

/** True when payments cover the pledged amount. */
export function isPledgeCovered(amount: number, paid: number): boolean {
  return paid >= amount - TOLERANCE;
}

/**
 * The status a pledge should have now that its payments have changed, or null
 * when it should be left alone.
 *
 * Only ever moves between "active" and "completed". A pledge someone
 * deliberately cancelled stays cancelled — recording a payment against it does
 * not quietly revive it, and removing one does not reopen it.
 */
export function nextPledgeStatus(
  current: PledgeStatus,
  amount: number,
  paid: number,
): PledgeStatus | null {
  if (current === "cancelled") return null;
  const next: PledgeStatus = isPledgeCovered(amount, paid)
    ? "completed"
    : "active";
  return next === current ? null : next;
}

/**
 * What is still owed on a pledge.
 *
 * Rounded to the currency's smallest unit and floored at zero, so a pledge
 * that has been paid off reads as settled rather than owing a fraction of a
 * kobo that no one can pay. Anything still open is reported to the cent.
 */
export function outstandingOn(amount: number, paid: number): number {
  if (isPledgeCovered(amount, paid)) return 0;
  return Math.round((amount - paid) * 100) / 100;
}
