/**
 * Pure maths for the Termii master wallet ("the float"). No imports, no DB —
 * these numbers decide whether SMS keeps working and whether it is profitable,
 * so they are unit-tested in isolation.
 *
 * Every function returns `null` rather than a misleading number when the
 * inputs cannot support an answer. A confident-looking zero on a funding
 * dashboard is worse than an honest "unknown".
 */

const DAY_MS = 86_400_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * What Termii charges per SMS page, derived from observed balance drawdown
 * over a window divided by the pages actually sent in it.
 */
export function deriveUnitCost({
  drawdown,
  pages,
}: {
  drawdown: number;
  pages: number;
}): number | null {
  if (!(pages > 0)) return null;
  // A non-positive drawdown means the window contained a top-up, or no spend —
  // either way it cannot tell us a unit price.
  if (!(drawdown > 0)) return null;
  return round2(drawdown / pages);
}

/** Days of sending left at the current burn rate. */
export function runwayDays({
  balance,
  dailyBurn,
}: {
  balance: number;
  dailyBurn: number;
}): number | null {
  if (!(dailyBurn > 0)) return null;
  if (balance <= 0) return 0;
  return round2(balance / dailyBurn);
}

/**
 * Termii balance ÷ what it would cost to honour every SMS page already sold.
 * Below 1.0 means SMS has been paid for that cannot currently be delivered.
 * `Infinity` means nothing is owed.
 */
export function coverageRatio({
  balance,
  liabilityPages,
  unitCost,
}: {
  balance: number;
  liabilityPages: number;
  unitCost: number;
}): number | null {
  if (!(unitCost > 0)) return null;
  const needed = liabilityPages * unitCost;
  if (needed <= 0) return Infinity;
  return round4(balance / needed);
}

/**
 * SMS pages one church has paid for and not yet sent.
 *
 * Wallets are unified across SMS and storage, so storage the church is already
 * committed to (renewing within 31 days, or overdue) is subtracted before the
 * remainder is treated as SMS credit.
 */
export function smsLiabilityPages({
  walletBalance,
  storageMonthlyCost,
  storageRenewsAt,
  smsPrice,
  now,
}: {
  walletBalance: number;
  storageMonthlyCost: number;
  storageRenewsAt: Date | null;
  smsPrice: number;
  now: Date;
}): number {
  if (!(smsPrice > 0)) return 0;

  const dueSoon =
    storageRenewsAt !== null &&
    storageRenewsAt.getTime() - now.getTime() <= 31 * DAY_MS;
  const committed = dueSoon ? Math.max(0, storageMonthlyCost) : 0;

  const spendable = Math.max(0, walletBalance - committed);
  return Math.floor(spendable / smsPrice);
}

/** Profit on a number of SMS pages: what was charged minus what it cost. */
export function marginFor({
  pages,
  smsPrice,
  unitCost,
}: {
  pages: number;
  smsPrice: number;
  unitCost: number;
}): number {
  return round2(pages * (smsPrice - unitCost));
}

export type BalancePoint = { balance: number | null; fetchedAt: Date };

/**
 * Average daily spend from consecutive balance snapshots. Only decreases count,
 * so top-ups do not read as negative spend. Uses real drawdown, which also
 * captures any sending done outside FlockInsight on the same Termii account.
 */
export function dailyBurnFromSnapshots(
  snapshots: BalancePoint[],
  days: number,
): number | null {
  if (!(days > 0)) return null;

  const usable = snapshots
    .filter((s): s is { balance: number; fetchedAt: Date } => s.balance !== null)
    .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  if (usable.length < 2) return null;

  let drawdown = 0;
  for (let i = 1; i < usable.length; i++) {
    const delta = usable[i - 1].balance - usable[i].balance;
    if (delta > 0) drawdown += delta;
  }

  return round2(drawdown / days);
}
