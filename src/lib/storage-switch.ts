/**
 * What switching storage bundles costs right now. Pure and client-safe, so
 * the button can name the exact amount the server will then take.
 *
 * Switching used to charge a whole fresh month of the new bundle and restart
 * the renewal date, with nothing back for the unused part of the old one: a
 * church on +20GB that mis-tapped "+5GB" three days into its month paid for
 * +5GB in full and threw away 27 days of +20GB. So a switch inside a paid
 * month is now settled on the DIFFERENCE, for the days that are left:
 *
 *   - bigger bundle: pay (new − old) × the share of the month remaining;
 *   - smaller bundle: get (old − new) × that share back in the wallet;
 *   - either way the renewal date stays where it was, and from then on the
 *     new bundle's price is what renews.
 *
 * Up and back down again nets to nothing (give or take rounding, which always
 * favours neither side by more than ₦1: charges round up, refunds round
 * down). With no add-on running, or one already lapsed, it is a plain first
 * month, as before.
 */

export type StorageState = {
  /** The add-on running now, in GB. 0 = none. */
  currentGb: number;
  /** What it renews at each month, in naira. */
  currentMonthlyCost: number;
  /** When it next renews. Null = no add-on. */
  renewsAt: Date | string | null;
};

export type SwitchQuote =
  | { kind: "same" }
  /** No add-on running: the first month in full, renewing a month from now. */
  | { kind: "new"; charge: number; renewsAt: Date }
  /** Mid-month change: pay or get back the difference, keep the date. */
  | { kind: "upgrade"; charge: number; renewsAt: Date }
  | { kind: "downgrade"; refund: number; renewsAt: Date };

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/** Share of the current month still to run: 0..1. */
export function remainingShare(renewsAt: Date, now: Date): number {
  const start = new Date(renewsAt);
  start.setMonth(start.getMonth() - 1);
  const span = renewsAt.getTime() - start.getTime();
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (renewsAt.getTime() - now.getTime()) / span));
}

export function storageSwitchQuote(
  state: StorageState,
  next: { gb: number; price: number },
  now: Date = new Date(),
): SwitchQuote {
  const renews = toDate(state.renewsAt);
  const running = state.currentGb > 0 && renews !== null && renews.getTime() > now.getTime();

  if (running && state.currentGb === next.gb) return { kind: "same" };
  if (!running || !renews) {
    return { kind: "new", charge: Math.max(0, Math.ceil(next.price)), renewsAt: addOneMonth(now) };
  }

  const share = remainingShare(renews, now);
  const diff = next.price - state.currentMonthlyCost;
  if (next.gb > state.currentGb) {
    return { kind: "upgrade", charge: Math.max(0, Math.ceil(diff * share)), renewsAt: renews };
  }
  return { kind: "downgrade", refund: Math.max(0, Math.floor(-diff * share)), renewsAt: renews };
}
