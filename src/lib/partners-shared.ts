/**
 * What a Partner earns, and what they may withdraw. No database in here.
 *
 * This is the money. Every rule that decides an amount lives in this file and
 * is tested without a database, because the cost of being wrong is not a broken
 * page — it is paying somebody the wrong sum, or not paying them, and either
 * one is noticed by a person who is counting on it.
 *
 * Four decisions are encoded, and each of them is a decision rather than an
 * implementation detail:
 *
 *   Rates are in BASIS POINTS. 40% is 4000. Percentages invite fractions and
 *   fractions invite rounding twice; an integer cannot drift.
 *
 *   A tier is EARNED, not stored. It is computed from how many of the
 *   Partner's churches are live and paying right now — because a stored tier
 *   silently stops being true, and because qualifying on sign-ups rather than
 *   on payments would pay for churn.
 *
 *   The second commission is held until the church's SECOND payment actually
 *   clears. Not a clawback: it simply is not earned until the money arrives.
 *   That removes the whole incentive to sign a church that cannot pay.
 *
 *   And money is rounded to the minor unit ONCE, at the point an amount is
 *   decided, never again afterwards.
 */

export type PartnerTier = {
  /** What the Partner is called at this level. */
  name: string;
  /** Churches live and paying, in the rolling window, to reach it. */
  minChurches: number;
  /**
   * Commission on a referred church's first MONTH paid for, in basis points.
   * A month, not a payment: a year paid at once earns the first, the second
   * and the trail in one go.
   */
  firstBps: number;
  /** Commission on its second month paid for. */
  secondBps: number;
};

export type PartnerRates = {
  tiers: PartnerTier[];
  /**
   * The recurring slice, paid for `trailMonths` after the first two months.
   *
   * The single biggest reason a Partner stays: it turns a one-off hunt into an
   * income that grows, and it quietly makes them want their churches to
   * succeed rather than merely to sign. Zero turns it off.
   */
  trailBps: number;
  trailMonths: number;
  /** The least a Partner may withdraw, in major units. */
  minPayout: number;
  /**
   * How long a Partner's churches are counted for the tier, in days.
   *
   * Rolling rather than a calendar month, deliberately. "50 churches in a
   * month" is unreachable for almost everybody and demoralising by the 20th;
   * a rolling window means effort always counts towards something.
   */
  tierWindowDays: number;
};

/**
 * The ladder as shipped, and the reasoning is in the night notes of 11 Oct.
 *
 * 40% of the first two payments is roughly four fifths of a month of revenue
 * per church — generous, and the right shape for acquisition. The steps above
 * it are deliberately climbable: a ladder whose first rung is fifty churches
 * is a ladder nobody steps on.
 */
export const DEFAULT_PARTNER_RATES: PartnerRates = {
  tiers: [
    { name: "Partner", minChurches: 0, firstBps: 4000, secondBps: 4000 },
    { name: "Senior Partner", minChurches: 5, firstBps: 4500, secondBps: 4500 },
    { name: "Lead Partner", minChurches: 15, firstBps: 5000, secondBps: 5000 },
    { name: "Regional Partner", minChurches: 40, firstBps: 5000, secondBps: 5000 },
  ],
  trailBps: 500,
  trailMonths: 12,
  minPayout: 10_000,
  tierWindowDays: 90,
};

/** Rates are stored as JSON and may arrive from an older shape. Normalise. */
export function normaliseRates(raw: unknown): PartnerRates {
  const d = DEFAULT_PARTNER_RATES;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<PartnerRates>;

  const tiers = Array.isArray(r.tiers)
    ? r.tiers
        .filter((t): t is PartnerTier => !!t && typeof t === "object")
        .map((t) => ({
          name: String(t.name ?? "Partner").slice(0, 40) || "Partner",
          minChurches: clampInt(t.minChurches, 0, 0, 100_000),
          firstBps: clampInt(t.firstBps, 0, 0, 10_000),
          secondBps: clampInt(t.secondBps, 0, 0, 10_000),
        }))
        .sort((a, b) => a.minChurches - b.minChurches)
    : d.tiers;

  return {
    tiers: tiers.length > 0 ? tiers : d.tiers,
    trailBps: clampInt(r.trailBps, d.trailBps, 0, 10_000),
    trailMonths: clampInt(r.trailMonths, d.trailMonths, 0, 120),
    minPayout: clampInt(r.minPayout, d.minPayout, 0, 100_000_000),
    tierWindowDays: clampInt(r.tierWindowDays, d.tierWindowDays, 1, 3650),
  };
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Which tier this Partner is on.
 *
 * `liveChurches` is churches that are live AND paying inside the rolling
 * window — never sign-ups. An override wins, because some arrangements a rule
 * cannot see are real.
 */
export function tierFor(
  rates: PartnerRates,
  liveChurches: number,
  override?: string | null,
): PartnerTier {
  if (override) {
    const named = rates.tiers.find(
      (t) => t.name.toLowerCase() === override.toLowerCase(),
    );
    if (named) return named;
  }
  let earned = rates.tiers[0];
  for (const t of rates.tiers) if (liveChurches >= t.minChurches) earned = t;
  return earned;
}

/** The next rung, and how many more churches it takes. Null at the top. */
export function nextTier(
  rates: PartnerRates,
  liveChurches: number,
): { tier: PartnerTier; needed: number } | null {
  const ahead = rates.tiers
    .filter((t) => t.minChurches > liveChurches)
    .sort((a, b) => a.minChurches - b.minChurches)[0];
  if (!ahead) return null;
  return { tier: ahead, needed: ahead.minChurches - liveChurches };
}

/** Money, to the minor unit, rounded once. */
export function applyRate(amount: number, bps: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.round(amount * bps) / 10_000;
}

/**
 * `reversal` is the one kind that is never computed from a month: it is the
 * negative row written when a payment is voided after its commission had
 * already left the wallet (see `reversePartnerCommission`). It is a ledger
 * entry rather than an edit, so the earning it offsets still says what was paid.
 */
export type EarningKind = "first" | "second" | "trail" | "bonus" | "reversal";

/**
 * Which commission one MONTH of a subscription earns, and at what rate.
 *
 * Months rather than payments, because a payment is not always a month: a
 * church paying for a year hands over one payment covering twelve of them.
 * Returns null for a month that earns nothing, which is the ordinary answer
 * once the trail has run out.
 *
 * The trail starts at the THIRD month, because the first two already carry the
 * big commission. Paying both for the same month would be paying twice for one
 * event.
 */
function rateForMonth(
  rates: PartnerRates,
  tier: PartnerTier,
  monthNumber: number,
): { kind: EarningKind; rateBps: number } | null {
  if (!Number.isFinite(monthNumber) || monthNumber < 1) return null;
  if (monthNumber === 1) return { kind: "first", rateBps: tier.firstBps };
  if (monthNumber === 2) return { kind: "second", rateBps: tier.secondBps };

  const trailMonth = monthNumber - 2;
  if (rates.trailBps <= 0 || trailMonth > rates.trailMonths) return null;
  return { kind: "trail", rateBps: rates.trailBps };
}

/** One commission row: a kind, a rate, and how many months it covers. */
export type EarningLine = {
  kind: EarningKind;
  amount: number;
  rateBps: number;
  /** How many months of the subscription this line was computed over. */
  months: number;
  /** The first and last month of the subscription it covers, inclusive. */
  fromMonth: number;
  toMonth: number;
};

/**
 * Everything a Partner earns from ONE payment, which may cover many months.
 *
 * ## Why this exists, and what it fixes
 *
 * A church paying for a year makes a single payment. Counted as one payment it
 * earned the Partner one commission — the first — and then the Partner waited
 * a whole year for the second, and never saw a single month of trail, because
 * by the time the second payment arrived the trail window had been consumed by
 * nothing. The Partner who closed the better deal, a year of committed revenue
 * up front, was paid a quarter of what they would have earned from the same
 * church paying monthly. That is backwards, and it is the reason this function
 * replaced the one-payment-one-commission version.
 *
 * So an annual payment is priced as what it actually is: the twelve months it
 * buys. `firstMonth` is the first month of the subscription this payment pays
 * for, counting from one, and `months` is how many it covers. Each covered
 * month is priced on its own — first, second, trail or nothing — and the
 * Partner is paid the lot at once, now, rather than in instalments that depend
 * on the church returning.
 *
 * ## The base is what the church actually paid
 *
 * Divided across the months it covers, which keeps the Partner's share of
 * REVENUE identical whichever way the church pays. Twelve months at ₦10,000 is
 * ₦120,000 and earns 40% + 40% + ten months of 5%; the same year bought at the
 * annual price is ₦100,000 and earns 40% + 40% + ten months of 5% of a
 * proportionally smaller month. The Partner does not profit from the discount
 * the church got, and does not pay for it either — they are simply paid now.
 *
 * ## Why the lines are grouped
 *
 * `partner_earning_once_idx` is unique on (payment, kind), which is what makes
 * awarding idempotent against a replayed gateway callback. Ten separate trail
 * rows for one payment cannot exist, and should not: they would be ten rows
 * saying the same thing. So the months of each kind are summed into ONE base
 * and the rate is applied ONCE, which also means the money is rounded once —
 * the rule the whole module is built on.
 */
export function earningsForPayment(opts: {
  rates: PartnerRates;
  tier: PartnerTier;
  /** The whole payment, in major units. */
  amount: number;
  /** The first month of the subscription this payment covers, from one. */
  firstMonth: number;
  /** How many months it covers. 1 for a monthly payment, 12 for a year. */
  months: number;
}): EarningLine[] {
  const { rates, tier, amount, firstMonth } = opts;
  const months = Math.max(1, Math.round(opts.months || 1));
  if (!Number.isFinite(amount) || amount <= 0) return [];
  if (!Number.isFinite(firstMonth) || firstMonth < 1) return [];

  const perMonth = amount / months;

  // Grouped by kind AND rate: a rate cannot change inside one payment today,
  // but grouping on both means it could without quietly mixing two rates into
  // one row that can no longer be explained.
  const groups = new Map<
    string,
    { kind: EarningKind; rateBps: number; months: number; from: number; to: number }
  >();

  for (let i = 0; i < months; i++) {
    const monthNumber = firstMonth + i;
    const rate = rateForMonth(rates, tier, monthNumber);
    if (!rate) continue;
    const key = `${rate.kind}:${rate.rateBps}`;
    const g = groups.get(key);
    if (g) {
      g.months += 1;
      g.to = monthNumber;
    } else {
      groups.set(key, {
        kind: rate.kind,
        rateBps: rate.rateBps,
        months: 1,
        from: monthNumber,
        to: monthNumber,
      });
    }
  }

  const order: EarningKind[] = ["first", "second", "trail", "bonus", "reversal"];
  return [...groups.values()]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((g) => ({
      kind: g.kind,
      // Rounded once, here, over every month of this kind together.
      amount: applyRate(perMonth * g.months, g.rateBps),
      rateBps: g.rateBps,
      months: g.months,
      fromMonth: g.from,
      toMonth: g.to,
    }))
    .filter((line) => line.amount > 0);
}

/**
 * What a Partner earns from one payment covering one month.
 *
 * Kept because a monthly payment is still the common case and reads better as
 * one answer than as a list of one. `paymentNumber` is which month of the
 * subscription it pays for, counting from one.
 */
export function earningFor(opts: {
  rates: PartnerRates;
  tier: PartnerTier;
  amount: number;
  paymentNumber: number;
}): { kind: EarningKind; amount: number; rateBps: number } | null {
  const [line] = earningsForPayment({
    rates: opts.rates,
    tier: opts.tier,
    amount: opts.amount,
    firstMonth: opts.paymentNumber,
    months: 1,
  });
  if (!line) return null;
  return { kind: line.kind, amount: line.amount, rateBps: line.rateBps };
}

/**
 * What a Partner's commission is a share of: the plan's price, not the money
 * that passed through to a card network.
 *
 * An international church pays the plan price plus a surcharge that exists to
 * cover Paystack's international card fee (and whatever rounding to a whole
 * ₦100 added). That part is stored on the payment as `surchargeAmount`. Paying
 * 40% of it to a Partner gave them more for a Kenyan church than for the same
 * plan sold in Lagos, out of the very money that pays the fee — so the base is
 * `amount - surchargeAmount`, never below zero, and never more than was paid.
 */
export function commissionBase(amount: number, surchargeAmount?: number | null): number {
  const paid = Number(amount);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  const surcharge = Number(surchargeAmount ?? 0);
  const off = Number.isFinite(surcharge) && surcharge > 0 ? surcharge : 0;
  return Math.max(0, Math.round((paid - off) * 100) / 100);
}

/**
 * Drop a first or second commission the church has already earned elsewhere.
 *
 * A church has exactly one first month and one second month. The month count
 * in `awardPartnerCommission` is built so a payment cannot be priced as month
 * one twice, but it is a count over rows people date by hand, and the cost of
 * being wrong is paying the 40% twice. So the lines are checked against the
 * kinds the church's still-standing payments already carry, and a repeat is
 * removed rather than inserted. The trail legitimately appears on many
 * payments and is never touched; nor is anything else.
 */
export function dropRepeatedOneOffs(
  lines: EarningLine[],
  alreadyEarned: Iterable<EarningKind>,
): { kept: EarningLine[]; dropped: EarningLine[] } {
  const seen = new Set(alreadyEarned);
  const kept: EarningLine[] = [];
  const dropped: EarningLine[] = [];
  for (const line of lines) {
    if ((line.kind === "first" || line.kind === "second") && seen.has(line.kind)) {
      dropped.push(line);
    } else {
      kept.push(line);
    }
  }
  return { kept, dropped };
}

/**
 * The sentence stored on an earning that covers more than one month.
 *
 * Null for an ordinary monthly payment: there is nothing to explain, and a
 * ledger that annotates every row stops being readable. For an annual payment
 * it is the difference between "₦4,167 trail" and "₦4,167 — months 3–12 of a
 * 12-month payment, 5% of each", which is the question a Partner asks.
 */
export function earningNote(line: EarningLine, paymentMonths: number): string | null {
  if (paymentMonths <= 1) return null;
  const span =
    line.months === 1
      ? `month ${line.fromMonth}`
      : `months ${line.fromMonth}–${line.toMonth}`;
  return `${span} of a ${paymentMonths}-month payment · ${line.months} × ${(line.rateBps / 100).toFixed(line.rateBps % 100 === 0 ? 0 : 2)}%`;
}

export type EarningRow = {
  amount: number;
  status: "pending" | "available" | "paid" | "cancelled";
  /** Set once a withdrawal has claimed this row. */
  payoutId?: string | null;
};

/**
 * The numbers a wallet shows, and they must add up.
 *
 * `available` is what a withdrawal may draw on. `requested` is earned,
 * released, and already inside a withdrawal somebody is waiting on.
 * `pending` is earned but not yet released. `paid` is history. A cancelled row
 * counts towards none of them and is kept so the ledger still explains itself.
 *
 * **`requested` exists because status alone cannot tell you.** A row claimed by
 * an open payout stays `available` until that payout is marked paid — so
 * bucketing by status put money a Partner had already asked for back under
 * "Available", and the figure did not move when they pressed withdraw. Two
 * different situations, one number. It also means `available` is now the amount
 * a further withdrawal could really draw on, which is what `canWithdraw` wants.
 */
export function walletTotals(rows: EarningRow[]): {
  available: number;
  requested: number;
  pending: number;
  paid: number;
  lifetime: number;
} {
  let available = 0;
  let requested = 0;
  let pending = 0;
  let paid = 0;
  for (const r of rows) {
    const amount = Number.isFinite(r.amount) ? r.amount : 0;
    if (r.status === "available") {
      if (r.payoutId) requested += amount;
      else available += amount;
    } else if (r.status === "pending") pending += amount;
    else if (r.status === "paid") paid += amount;
  }
  return {
    available: round2(available),
    requested: round2(requested),
    pending: round2(pending),
    paid: round2(paid),
    lifetime: round2(available + requested + pending + paid),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Which unclaimed earnings a withdrawal of `amount` takes.
 *
 * Whole rows, oldest first — and every NEGATIVE row before any of them. A
 * negative row is a reversal: commission on a payment that was voided after
 * the money had already left. It is a debt against the next withdrawal and it
 * must be IN that withdrawal. Taking rows oldest-first alone stops as soon as
 * the request is covered, so a debt sitting behind a large earning would never
 * be reached and the payout would come out larger than the balance it was
 * drawn from.
 *
 * Null when what is there cannot cover the request, or nets to nothing. The
 * total is what the ledger gives up, which is what is paid.
 */
export function takeForPayout(
  rows: { id: string; amount: number }[],
  amount: number,
): { ids: string[]; total: number } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const debts = rows.filter((r) => r.amount < 0);
  const credits = rows.filter((r) => r.amount > 0);
  const ids = debts.map((r) => r.id);
  let running = debts.reduce((sum, r) => sum + r.amount, 0);
  for (const r of credits) {
    if (running >= amount - 0.001) break;
    ids.push(r.id);
    running += r.amount;
  }
  if (running < amount - 0.001 || running <= 0) return null;
  return { ids, total: round2(running) };
}

export type PayoutStatus = "requested" | "approved" | "paid" | "rejected";
export type PayoutDecision = "approved" | "paid" | "rejected";

/**
 * Where a withdrawal may go from where it is. Anything not listed is refused.
 *
 * Paid and rejected are FINAL. Before this table the only check was "not
 * already paid", read before the transaction: a request rejected in one tab —
 * its earnings handed back, and then claimed by a new request — could still be
 * marked paid from a stale tab, and the same money went out twice.
 *
 * A request may be marked paid straight from "requested". Approving first is
 * the usual path, but "paid" is recorded AFTER a human has already made the
 * transfer — refusing it then does not stop the money, it only leaves the
 * ledger saying "requested" about money that has gone, where a later reject
 * would hand those earnings back to be withdrawn a second time. (A version of
 * this table required approval first; the queue offers "Mark paid" on every
 * open row, so every admin following the page was refused after paying.)
 *
 * `decidePayout` repeats this table in its UPDATE's WHERE, so it holds against
 * two decisions racing as well as against a stale page.
 */
export const PAYOUT_TRANSITIONS: Record<PayoutDecision, readonly PayoutStatus[]> = {
  approved: ["requested"],
  paid: ["requested", "approved"],
  rejected: ["requested", "approved"],
};

export function payoutTransitionAllowed(from: string, to: PayoutDecision): boolean {
  return (PAYOUT_TRANSITIONS[to] as readonly string[]).includes(from);
}

/** Why a decision was refused, in words the person at the queue can act on. */
export function payoutTransitionError(from: string, to: PayoutDecision): string {
  if (from === "paid") return "That one is already paid.";
  if (from === "rejected") return "That request was already rejected. Refresh the page.";
  // Only "approved" again is left: approving is the one step that needs a
  // fresh request.
  return `That request is already ${from}, so it cannot be ${to} now. Refresh the page.`;
}

export type BankDetails = {
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
};

/** Is this a different account, or the same one saved again? */
export function bankDetailsChanged(before: BankDetails, after: BankDetails): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return (
    norm(before.bankName) !== norm(after.bankName) ||
    norm(before.bankAccountNumber) !== norm(after.bankAccountNumber) ||
    norm(before.bankAccountName) !== norm(after.bankAccountName)
  );
}

/**
 * How recent an email code must be to authorise changing where money goes.
 *
 * Long enough to verify and then fill in a bank form; short enough that a
 * verification from last month says nothing about who is holding the session
 * now.
 */
export const BANK_CHANGE_FRESH_MS = 15 * 60_000;

/**
 * Does a change of bank account keep the Partner's email verification?
 *
 * Only when that verification is FRESH — a code confirmed in the last few
 * minutes, which proves whoever is changing the account can read the inbox on
 * file. Otherwise the change clears it and nothing can be withdrawn until a
 * new code is confirmed. A stolen session (a shared phone left signed in) can
 * change an account number; it cannot read the email, and the email is the
 * one address on a Partner that a session cannot change. The phone is no help
 * here: a session holder can put in their own number and verify it.
 */
export function bankChangeKeepsVerification(
  emailVerifiedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!emailVerifiedAt) return false;
  const at = new Date(emailVerifiedAt).getTime();
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age <= BANK_CHANGE_FRESH_MS;
}

/**
 * The ceilings on verification codes a Partner can make us send.
 *
 * Every SMS here is paid from the platform's own Termii balance, not a
 * church's wallet, and a pending Partner account is one form away for any
 * signed-in user. Without a ceiling, "save a number, send a code" in a loop
 * spent our float on strangers and put the sender ID at risk of being flagged.
 * Per Partner, per destination and per address, in memory for the burst; per
 * Partner and per destination over a day, in the database, because the
 * in-memory count is per worker and forgets on every deploy.
 */
export const PARTNER_OTP_LIMITS = {
  perPartnerHour: 5,
  perDestinationHour: 3,
  perIpHour: 10,
  perPartnerDay: 8,
  perDestinationDay: 5,
  phoneChangesPerDay: 3,
  bankChangesPerDay: 5,
} as const;

/** An account number as it may appear in a message: the last four digits. */
export function maskAccount(accountNumber: string | null | undefined): string {
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  return digits ? `****${digits.slice(-4)}` : "****";
}

/**
 * May this Partner withdraw this much?
 *
 * Says no with the reason, because every one of these is something the person
 * can act on — and a disabled button with no sentence beside it is the most
 * common way a payout request turns into a support ticket.
 */
export function canWithdraw(opts: {
  rates: PartnerRates;
  available: number;
  amount: number;
  status: "pending" | "active" | "suspended";
  hasBank: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  openRequest: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (opts.status !== "active") {
    return {
      ok: false,
      reason:
        opts.status === "pending"
          ? "Your Partner account is still being approved."
          : "Your Partner account is suspended. Please contact support.",
    };
  }
  if (!opts.hasBank) {
    return { ok: false, reason: "Add your bank account details first." };
  }
  if (!opts.emailVerified || !opts.phoneVerified) {
    return {
      ok: false,
      reason: "Verify your email address and phone number before withdrawing.",
    };
  }
  if (opts.openRequest) {
    return {
      ok: false,
      reason: "You already have a withdrawal being processed.",
    };
  }
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    return { ok: false, reason: "Enter how much you want to withdraw." };
  }
  if (opts.amount < opts.rates.minPayout) {
    return {
      ok: false,
      reason: `The smallest withdrawal is ${opts.rates.minPayout.toLocaleString()}.`,
    };
  }
  if (opts.amount > opts.available) {
    return { ok: false, reason: "That is more than your available balance." };
  }
  return { ok: true };
}


/* ============================================================
 * Proving a verification code is this Partner's
 * ========================================================== */

/**
 * One normaliser, used when a code is SENT and again when it is checked.
 *
 * The destination stored on an OTP is compared against the Partner's current
 * email or phone to prove the code went to them, and that comparison is only
 * sound if both sides were spelled the same way. An email differing by case,
 * or a number written with spaces, would fail a check that should pass.
 */
export function otpDestination(which: "email" | "phone", raw: string): string {
  return which === "email" ? raw.trim().toLowerCase() : canonicalPhone(raw);
}

/**
 * A phone number in the ONE spelling the SMS gateway uses: digits only, with
 * the Nigerian 0 or bare ten digits turned into 234… — the same rule as
 * `normalizePhone` in lib/sms (which is server-only, so it is restated here
 * and the test pins the cases). Empty when it cannot be a number.
 *
 * One spelling is what makes a per-number limit mean what it says. "0801…",
 * "+234 801…" and "234801…" are the same phone, and while they were three
 * destinations the throttle on codes per destination was three throttles.
 */
export function canonicalPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("234")) return digits.length === 13 ? digits : "";
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    return rest.length === 10 ? `234${rest}` : "";
  }
  if (digits.length === 10) return `234${digits}`;
  return digits.length >= 10 ? digits : "";
}

/**
 * Is this stored code genuinely this Partner's, for this field?
 *
 * Three conditions, and each one closes a real hole:
 *
 *   PURPOSE — without it, a code from any other flow, including the Partner's
 *   own email verification, could be submitted as `which: "phone"` and mark a
 *   number verified that was never texted.
 *
 *   PARTNER — without it, one Partner's code could verify another's details.
 *
 *   DESTINATION — without it, somebody could request a code to a number they
 *   control, change the number on their profile, and verify the new one with
 *   the old code.
 *
 * Email and phone verification are gates on withdrawing money, so all three are
 * load-bearing rather than tidy. Pure, and tested, because a hole here is not a
 * broken page.
 */
export function otpBelongsToPartner(opts: {
  which: "email" | "phone";
  partnerId: string;
  /** The Partner's current address or number, already normalised. */
  expectedDestination: string;
  stored: {
    purpose: string;
    destination: string;
    payload: Record<string, unknown> | null;
  };
}): boolean {
  const { which, partnerId, expectedDestination, stored } = opts;
  if (!expectedDestination) return false;
  if (stored.purpose !== `partner_${which}`) return false;
  if ((stored.payload ?? {}).partnerId !== partnerId) return false;
  if (stored.destination !== expectedDestination) return false;
  return true;
}

/* ============================================================
 * The code in the link
 * ========================================================== */

/**
 * The alphabet a code is read out loud in.
 *
 * The same reasoning as a meeting code: an agent reads this down a phone line
 * to a pastor in a hurry, so it drops every character that sounds or looks
 * like another one — no vowels (so it cannot spell a word by accident), no
 * 0/O, no 1/I/L, no 5/S, no 2/Z.
 */
const CODE_ALPHABET = "bcdfghjkmnpqrtvwxy34679";

export function generatePartnerCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** What a person typed, turned into what we store. */
export function normalisePartnerCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
}

/**
 * The one-line description of the programme, for search results and link
 * previews — built from the live rates, like every other number on the page.
 *
 * It used to promise a share "on every payment, for as long as they stay",
 * while the trail stops after `trailMonths`. A preview is the first thing a
 * prospective Partner reads, and it was the one sentence on the page that was
 * not true.
 */
export function partnerProgramDescription(rates: PartnerRates): string {
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
  const trail =
    rates.trailBps > 0 && rates.trailMonths > 0
      ? `, then ${pct(rates.trailBps)} of every payment for the next ${rates.trailMonths} months`
      : "";
  return `Bring churches onto FlockInsight and earn a commission on their first two months${trail}. Commission rates, tiers, payouts and terms.`;
}

export function partnerLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/signup?ref=${code}`;
}
