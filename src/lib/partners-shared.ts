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
  /** Commission on a referred church's first payment, in basis points. */
  firstBps: number;
  /** Commission on its second payment. */
  secondBps: number;
};

export type PartnerRates = {
  tiers: PartnerTier[];
  /**
   * The recurring slice, paid for `trailMonths` after the first two payments.
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

export type EarningKind = "first" | "second" | "trail" | "bonus";

/**
 * What a Partner earns from one payment by one of their churches.
 *
 * `paymentNumber` is which successful payment this is for that church,
 * counting from one — so the caller's job is to count, and this function's job
 * is to price. Returns null when nothing is earned, which is the ordinary
 * answer once the trail has run out.
 *
 * The trail starts at the THIRD payment, because the first two already carry
 * the big commission. Paying both on the same payment would be paying twice
 * for one event.
 */
export function earningFor(opts: {
  rates: PartnerRates;
  tier: PartnerTier;
  amount: number;
  paymentNumber: number;
}): { kind: EarningKind; amount: number; rateBps: number } | null {
  const { rates, tier, amount, paymentNumber } = opts;
  if (!Number.isFinite(paymentNumber) || paymentNumber < 1) return null;

  if (paymentNumber === 1) {
    const value = applyRate(amount, tier.firstBps);
    return value > 0 ? { kind: "first", amount: value, rateBps: tier.firstBps } : null;
  }
  if (paymentNumber === 2) {
    const value = applyRate(amount, tier.secondBps);
    return value > 0 ? { kind: "second", amount: value, rateBps: tier.secondBps } : null;
  }

  // The trail: every payment after the first two, for a while.
  const trailPayment = paymentNumber - 2;
  if (rates.trailBps <= 0 || trailPayment > rates.trailMonths) return null;
  const value = applyRate(amount, rates.trailBps);
  return value > 0 ? { kind: "trail", amount: value, rateBps: rates.trailBps } : null;
}

export type EarningRow = {
  amount: number;
  status: "pending" | "available" | "paid" | "cancelled";
};

/**
 * The three numbers a wallet shows, and they must add up.
 *
 * `available` is what a withdrawal may draw on. `pending` is earned but not
 * yet released. `paid` is history. A cancelled row counts towards none of
 * them and is kept so the ledger still explains itself.
 */
export function walletTotals(rows: EarningRow[]): {
  available: number;
  pending: number;
  paid: number;
  lifetime: number;
} {
  let available = 0;
  let pending = 0;
  let paid = 0;
  for (const r of rows) {
    const amount = Number.isFinite(r.amount) ? r.amount : 0;
    if (r.status === "available") available += amount;
    else if (r.status === "pending") pending += amount;
    else if (r.status === "paid") paid += amount;
  }
  return {
    available: round2(available),
    pending: round2(pending),
    paid: round2(paid),
    lifetime: round2(available + pending + paid),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  return which === "email" ? raw.trim().toLowerCase() : raw.replace(/[^0-9+]/g, "");
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

export function partnerLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/signup?ref=${code}`;
}
