/**
 * Cost to serve and profit: the arithmetic, with no database and no clock.
 *
 * lib/cost-to-serve.ts reads the figures; everything that turns them into
 * "what did church X cost us" and "are we making money" happens here, so
 * every rule is a unit test away (cost-to-serve-shared.test.ts).
 *
 * THE MODEL, in the words the page uses:
 *
 *   Revenue        plan payments, spread over the months they pay for (a
 *                  year paid in March is a twelfth in each month, not a
 *                  windfall in March); what churches SPENT from their
 *                  wallets on SMS and storage (a top-up is money we hold,
 *                  not money we earned); and income entered by hand.
 *                  "capital" (a loan, an investment) is cash, never profit.
 *
 *   Cost to serve  what keeping churches running costs: the bills entered
 *                  under a serving category, plus everything measured — SMS
 *                  pages times the Termii cost per page, AI to the
 *                  nano-dollar, meeting egress past Cloudflare's free tier,
 *                  and what Paystack kept on each payment.
 *
 *   Winning churches  marketing bills, Partner commission, referral credit.
 *   Running the business  people, office, legal, credit given by hand.
 *
 *   Gross profit = revenue − cost to serve.  Profit = revenue − everything.
 *
 * Every cost entered says how it is SHARED between churches (its driver):
 * hosting evenly between the churches active that month, an email plan by
 * emails sent, a storage plan by bytes held. Measured costs need no driver:
 * they are already per church. A cost whose driver finds nobody that month
 * (a meetings bill in a month with no meetings) stays in the totals as
 * "not traced to a church" rather than vanishing.
 *
 * Money is naira throughout. Dollar costs are converted by the caller, at
 * the rate the operator says their bank charges when they have said so.
 */

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export type MonthKey = string; // "YYYY-MM"

export const BUCKETS = [
  "core",
  "sms",
  "mail",
  "meetings",
  "media",
  "ai",
  "payments",
  "acquisition",
  "overhead",
] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Buckets that are the cost of SERVING churches, as opposed to winning them or running the company. */
export const SERVE_BUCKETS: readonly Bucket[] = ["core", "sms", "mail", "meetings", "media", "ai", "payments"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  core: "Running the platform",
  sms: "SMS",
  mail: "Email",
  meetings: "Meetings",
  media: "Media & storage",
  ai: "AI",
  payments: "Payment fees",
  acquisition: "Winning churches",
  overhead: "Running the business",
};

export const COST_DRIVERS = [
  "active_churches",
  "all_churches",
  "paying_churches",
  "members",
  "emails",
  "sms_pages",
  "storage",
  "meetings",
  "ai",
  "revenue",
  "none",
] as const;
export type CostDriver = (typeof COST_DRIVERS)[number];

export const DRIVER_LABEL: Record<CostDriver, string> = {
  active_churches: "Evenly between churches active that month",
  all_churches: "Evenly between every church",
  paying_churches: "Evenly between paying churches",
  members: "By number of members",
  emails: "By emails sent",
  sms_pages: "By SMS pages sent",
  storage: "By storage used",
  meetings: "By meeting data used",
  ai: "By AI use",
  revenue: "By what each church paid",
  none: "Not shared: a cost of the business, not of a church",
};

type CategoryDef = {
  key: string;
  label: string;
  bucket: Bucket;
  driver: CostDriver;
  /** Shown under the category in the form: what to put here, and what NOT to. */
  hint: string;
};

export const COST_CATEGORIES = [
  {
    key: "hosting",
    label: "Hosting & servers",
    bucket: "core",
    driver: "active_churches",
    hint: "The VPS, database, backups, Cloudflare plan.",
  },
  {
    key: "domain",
    label: "Domains & DNS",
    bucket: "core",
    driver: "active_churches",
    hint: "flockinsight.com and any other domain. Enter the yearly price as yearly.",
  },
  {
    key: "software",
    label: "Software & tools",
    bucket: "core",
    driver: "active_churches",
    hint: "GitHub, monitoring, design tools the platform needs to run.",
  },
  {
    key: "email",
    label: "Email sending",
    bucket: "mail",
    driver: "emails",
    hint: "ZeptoMail or Resend credits and plans. Shared by emails each church sent.",
  },
  {
    key: "sms",
    label: "SMS, other than pages sent",
    bucket: "sms",
    driver: "sms_pages",
    hint: "Sender ID registration and similar. NOT Termii top-ups: pages sent are already counted at your cost per page.",
  },
  {
    key: "ai",
    label: "AI, other than API use",
    bucket: "ai",
    driver: "ai",
    hint: "NOT Anthropic API credit: every call is already measured to the cent.",
  },
  {
    key: "video",
    label: "Meetings & video",
    bucket: "meetings",
    driver: "meetings",
    hint: "A TURN server or streaming plan. Cloudflare egress past the free tier is already measured.",
  },
  {
    key: "storage",
    label: "Storage & media",
    bucket: "media",
    driver: "storage",
    hint: "Cloudinary plan, off-site backup storage. Shared by what each church stores.",
  },
  {
    key: "payments",
    label: "Payment processing",
    bucket: "payments",
    driver: "revenue",
    hint: "POS rental, bank charges. Paystack's fee on each payment is already counted.",
  },
  {
    key: "marketing",
    label: "Marketing & ads",
    bucket: "acquisition",
    driver: "none",
    hint: "Ads, flyers, events, sponsored posts. Pick the channel so each channel's cost per church can be worked out.",
  },
  {
    key: "people",
    label: "Staff & contractors",
    bucket: "overhead",
    driver: "none",
    hint: "Salaries, support staff, freelancers.",
  },
  {
    key: "office",
    label: "Office, power & internet",
    bucket: "overhead",
    driver: "none",
    hint: "Rent, fuel, data bundles, your laptop (spread a big purchase over its months).",
  },
  {
    key: "legal",
    label: "Legal, tax & compliance",
    bucket: "overhead",
    driver: "none",
    hint: "CAC filings, accountant, NDPR audit.",
  },
  { key: "other", label: "Other", bucket: "overhead", driver: "none", hint: "Anything else." },
] as const satisfies readonly CategoryDef[];

export type CostCategory = (typeof COST_CATEGORIES)[number]["key"];

export function categoryDef(key: string): CategoryDef {
  return (COST_CATEGORIES as readonly CategoryDef[]).find((c) => c.key === key) ?? COST_CATEGORIES[COST_CATEGORIES.length - 1];
}

export const FREQUENCIES = ["one_off", "monthly", "quarterly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  one_off: "One-off",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Yearly",
};

const MONTHS_PER: Record<Exclude<Frequency, "one_off">, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export const INCOME_CATEGORIES = [
  { key: "church_other", label: "A church paid for something other than a plan", profit: true, needsChurch: true },
  { key: "wallet_offline", label: "A church paid for wallet credit you added by hand", profit: true, needsChurch: true },
  { key: "services", label: "Services, training or consulting", profit: true, needsChurch: false },
  { key: "donation", label: "Donation or gift", profit: true, needsChurch: false },
  { key: "grant", label: "Grant", profit: true, needsChurch: false },
  { key: "capital", label: "Investment or loan (cash in, not profit)", profit: false, needsChurch: false },
  { key: "other", label: "Other income", profit: true, needsChurch: false },
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]["key"];

export function incomeDef(key: string) {
  return INCOME_CATEGORIES.find((c) => c.key === key) ?? INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1];
}

/** Marketing channels offered in the form. Free text is allowed too; these keep spellings consistent. */
export const CHANNEL_SUGGESTIONS = [
  "website",
  "google",
  "facebook",
  "instagram",
  "whatsapp",
  "youtube",
  "event",
  "outreach",
  "partner",
  "referral",
] as const;

/* ------------------------------------------------------------------ *
 * Months
 * ------------------------------------------------------------------ */

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // West Africa Time, no daylight saving

/** The calendar month in Lagos that a moment falls in. */
export function monthOf(d: Date): MonthKey {
  const t = new Date(d.getTime() + LAGOS_OFFSET_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month a "YYYY-MM-DD" date string falls in. */
export function monthOfDay(day: string): MonthKey {
  return day.slice(0, 7);
}

export function isMonthKey(v: unknown): v is MonthKey {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mo / 12);
  const mm = ((mo % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/** Whole months from a to b: monthsBetween("2026-01", "2026-03") = 2. */
export function monthsBetween(a: MonthKey, b: MonthKey): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

/** Every month from a to b inclusive, oldest first. Empty when b is before a. */
export function monthRange(a: MonthKey, b: MonthKey): MonthKey[] {
  const n = monthsBetween(a, b);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addMonths(a, i));
}

export function daysInMonth(m: MonthKey): number {
  return new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
}

export function monthLabel(m: MonthKey, long = false): string {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));
  return d.toLocaleDateString("en-GB", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ *
 * Entered costs
 * ------------------------------------------------------------------ */

export type CostItemInput = {
  id: string;
  name: string;
  category: string;
  /** Already in naira. */
  amountNgn: number;
  /** The item is priced in a foreign currency (its naira moves with the rate). */
  foreign: boolean;
  frequency: Frequency;
  startsOn: string; // YYYY-MM-DD
  endsOn: string | null;
  spreadMonths: number | null;
  driver: CostDriver;
  channel: string | null;
};

/**
 * What an entered cost costs in one month, in naira.
 *
 * A recurring cost is its monthly share (a year's domain is a twelfth a
 * month), counted for the days of the month it was live: one that starts on
 * the 16th of a 30-day month counts half. A one-off lands whole in the
 * month it was paid, or a fraction a month across `spreadMonths`.
 */
export function itemCostInMonth(item: Pick<CostItemInput, "amountNgn" | "frequency" | "startsOn" | "endsOn" | "spreadMonths">, m: MonthKey): number {
  const amount = Math.max(0, item.amountNgn);
  if (item.frequency === "one_off") {
    const spread = Math.max(1, item.spreadMonths ?? 1);
    const i = monthsBetween(monthOfDay(item.startsOn), m);
    return i >= 0 && i < spread ? amount / spread : 0;
  }
  const perMonth = amount / MONTHS_PER[item.frequency];
  const dim = daysInMonth(m);
  const first = `${m}-01`;
  const last = `${m}-${String(dim).padStart(2, "0")}`;
  const from = item.startsOn > first ? item.startsOn : first;
  const to = item.endsOn && item.endsOn < last ? item.endsOn : last;
  if (to < from) return 0;
  const days = Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1;
  return (perMonth * days) / dim;
}

/** The monthly figure a recurring cost settles at, for the list ("₦30,000 a year = ₦2,500 a month"). */
export function monthlyEquivalent(amountNgn: number, frequency: Frequency): number | null {
  return frequency === "one_off" ? null : amountNgn / MONTHS_PER[frequency];
}

/* ------------------------------------------------------------------ *
 * Measured costs
 * ------------------------------------------------------------------ */

/**
 * Paystack's published Nigerian pricing, for payments from before the actual
 * fee was kept (payment.gatewayFee). Local cards: 1.5% plus ₦100, the ₦100
 * waived under ₦2,500, the whole fee capped at ₦2,000. International: 3.9%
 * plus ₦100, uncapped. Every figure this produces is labelled an estimate.
 */
export const PAYSTACK_LOCAL = { pct: 0.015, flat: 100, flatFrom: 2500, cap: 2000 } as const;
export const PAYSTACK_INTL = { pct: 0.039, flat: 100 } as const;

export function paystackFeeEstimate(amount: number, international: boolean): number {
  if (!(amount > 0)) return 0;
  if (international) return round2(amount * PAYSTACK_INTL.pct + PAYSTACK_INTL.flat);
  const fee = amount * PAYSTACK_LOCAL.pct + (amount >= PAYSTACK_LOCAL.flatFrom ? PAYSTACK_LOCAL.flat : 0);
  return round2(Math.min(fee, PAYSTACK_LOCAL.cap));
}

/** Cloudflare Realtime: dollars per GB of egress, after the monthly free allowance. */
export const MEETING_USD_PER_GB = 0.05;
export const MEETING_FREE_GB = 1000;

export function meetingBillUsd(totalGb: number): number {
  return Math.max(0, totalGb - MEETING_FREE_GB) * MEETING_USD_PER_GB;
}

/** A plan payment, as the core needs it. */
export type PaymentInput = {
  churchId: string | null;
  paidAt: Date;
  amount: number;
  periodMonths: number;
  gateway: string;
  /** What Paystack reported keeping, or null when it was never asked. */
  fee: number | null;
  /** Carried an international surcharge, so it was charged as an international card. */
  international: boolean;
};

/** Which month gets which share of a plan payment. A year paid in March: a twelfth in each of March to February. */
export function paymentShares(p: Pick<PaymentInput, "paidAt" | "amount" | "periodMonths">): { month: MonthKey; amount: number }[] {
  const n = Math.max(1, Math.round(p.periodMonths || 1));
  const start = monthOf(p.paidAt);
  const share = p.amount / n;
  return Array.from({ length: n }, (_, i) => ({ month: addMonths(start, i), amount: share }));
}

/** The fee for a gateway payment: Paystack's own figure when we have it, else the published rate. */
export function gatewayFee(p: Pick<PaymentInput, "gateway" | "amount" | "fee" | "international">): { amount: number; estimated: boolean } {
  if (p.gateway !== "paystack") return { amount: 0, estimated: false };
  if (p.fee != null) return { amount: p.fee, estimated: false };
  return { amount: paystackFeeEstimate(p.amount, p.international), estimated: true };
}

/* ------------------------------------------------------------------ *
 * Sharing a cost between churches
 * ------------------------------------------------------------------ */

/**
 * Split `amount` in proportion to `weights`. Churches with no weight get
 * nothing; when nobody has any weight, everything is returned as
 * `untraced` so the total is never lost.
 */
export function shareOut(amount: number, weights: Map<string, number>): { byChurch: Map<string, number>; untraced: number } {
  let total = 0;
  for (const w of weights.values()) if (w > 0) total += w;
  const byChurch = new Map<string, number>();
  if (!(total > 0) || amount === 0) return { byChurch, untraced: amount };
  for (const [id, w] of weights) if (w > 0) byChurch.set(id, (amount * w) / total);
  return { byChurch, untraced: 0 };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export type ChurchInput = {
  id: string;
  name: string;
  planKey: string;
  planLabel: string;
  /** The month the church signed up. */
  joined: MonthKey;
  /** On a free trial today. */
  onTrial: boolean;
  /** How the church found us: a lead source, "partner", "referral", or "direct". */
  channel: string;
  members: number;
  storageBytes: number;
};

/** One church's usage in one month. Only months with something in them need a row. */
export type UsageInput = {
  churchId: string;
  month: MonthKey;
  smsPages: number;
  emails: number;
  meetingGb: number;
  /** Anyone from the church signed in and did something that month. */
  active: boolean;
};

export type MoneyByMonth = { churchId: string | null; month: MonthKey; amount: number };

export type CostInputs = {
  /** The months to report on, oldest first. */
  months: MonthKey[];
  /** The month that is still running, if it is in `months`: its usage is so far, its bills are whole. */
  currentMonth: MonthKey | null;
  churches: ChurchInput[];
  items: CostItemInput[];
  /** Every plan payment ever (a year paid last March still has months in this range). */
  payments: PaymentInput[];
  /** Paystack wallet top-ups: only their fee is a cost; the money itself is float. */
  topups: { churchId: string; paidAt: Date; amount: number; fee: number | null }[];
  /** What churches spent from their wallets, net of refunds. */
  walletSpend: (MoneyByMonth & { category: "sms" | "storage" })[];
  /** Wallet credit we handed out: referral rewards, and credit added by hand (net of hand debits). */
  creditsGiven: (MoneyByMonth & { kind: "referral" | "by_hand" })[];
  partnerCommission: MoneyByMonth[];
  income: { churchId: string | null; month: MonthKey; category: string; amountNgn: number }[];
  usage: UsageInput[];
  /** AI spend in naira by church; null church = the platform's own use. */
  ai: MoneyByMonth[];
  /** Naira per page Termii charges. Null when nobody has said. */
  smsUnitCost: number | null;
  /** What churches are charged per page. */
  smsPrice: number;
  /** What the Termii balance says was used, per month, when the readings cover it. */
  termiiMeasured: { month: MonthKey; spent: number }[];
  /** Naira per dollar, for the meetings bill. */
  ngnPerUsd: number;
  /**
   * The first month each kind of usage was ever recorded. Before it, a month
   * with nobody in it is a month nobody was counting, not one nobody used:
   * team activity only began to be recorded in July 2026, while churches had
   * signed up in June. Those months are shared between every church that
   * existed instead. Null or missing = never recorded yet.
   */
  recordedFrom?: Partial<Record<UsageKind, MonthKey | null>>;
};

export type UsageKind = "active" | "emails" | "smsPages" | "meetings";

/** Which usage a driver reads, for the drivers that read one. */
const DRIVER_USAGE: Partial<Record<CostDriver, UsageKind>> = {
  active_churches: "active",
  emails: "emails",
  sms_pages: "smsPages",
  meetings: "meetings",
};

export type CostLine = {
  key: string;
  label: string;
  bucket: Bucket;
  amount: number;
  /** entered: a bill typed in. measured: read from what happened. estimated: worked out from a published rate. */
  basis: "entered" | "measured" | "estimated";
  itemId?: string;
  detail?: string;
  /** The part no church could be found for (an entered cost in months nobody used what it pays for). */
  untraced?: number;
};

export type ChurchStatus = "paying" | "trial" | "free";

export type ChurchRow = {
  id: string;
  name: string;
  planKey: string;
  planLabel: string;
  status: ChurchStatus;
  channel: string;
  revenue: number;
  subscription: number;
  walletSpend: number;
  otherIncome: number;
  /** Cost to serve: measured costs that are theirs, plus their share of entered serving costs. */
  cost: number;
  costBy: Record<Bucket, number>;
  /** What it cost to win them: Partner commission and referral credit. Not part of cost to serve. */
  acquisition: number;
  margin: number;
  marginPct: number | null;
  smsPages: number;
  emails: number;
  meetingGb: number;
  storageBytes: number;
  members: number;
  activeMonths: number;
};

export type GroupRow = {
  key: string;
  label: string;
  churches: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  /** Per church per month, so a plan with three churches and one with thirty read side by side. */
  revenuePerChurchMonth: number;
  costPerChurchMonth: number;
};

export type MonthPoint = { month: MonthKey; revenue: number; serve: number; costs: number; profit: number };

export type ChannelRow = { channel: string; spend: number; newPaying: number; cac: number | null };

export type CostReport = {
  months: MonthKey[];
  partial: boolean;
  revenue: {
    subscriptions: number;
    walletSms: number;
    walletStorage: number;
    churchOther: number;
    otherIncome: number;
    total: number;
    /** Cash in that is not profit: loans and investment. */
    capital: number;
  };
  lines: CostLine[];
  byBucket: Record<Bucket, number>;
  serve: number;
  acquisition: number;
  overhead: number;
  totalCost: number;
  grossProfit: number;
  grossMarginPct: number | null;
  profit: number;
  marginPct: number | null;
  /** Serving cost no church could be found for (a bill in a month nobody used its feature). */
  untraced: number;
  series: MonthPoint[];
  churches: ChurchRow[];
  plans: GroupRow[];
  statuses: GroupRow[];
  features: { bucket: Bucket; label: string; cost: number; revenue: number }[];
  sms: {
    pages: number;
    revenue: number;
    cost: number;
    unitCost: number | null;
    price: number;
    /** (price − cost) / cost, as a whole percentage. */
    markupPct: number | null;
    /** What the Termii balance says was used over the same months, where readings cover them. */
    measured: number | null;
    measuredMonths: number;
    /** Measured minus attributed, over the months measured. Positive = SMS no church accounts for. */
    gap: number | null;
  };
  acquisitionStats: {
    spend: number;
    newPaying: number;
    cac: number | null;
    byChannel: ChannelRow[];
    /** Spend on marketing entered without a channel. */
    untaggedSpend: number;
    /** Average monthly gross profit from one paying church. */
    grossPerPayingMonth: number | null;
    paybackMonths: number | null;
    monthlyChurn: number | null;
    ltv: number | null;
    ltvToCac: number | null;
  };
  breakEven: {
    /** Average monthly cost that does not grow with churches: entered bills of every kind. */
    fixedPerMonth: number;
    /** What one paying church leaves per month after its measured costs. */
    contributionPerPaying: number | null;
    payingNow: number;
    payingNeeded: number | null;
  };
  fees: { actual: number; estimated: number; estimatedCount: number };
  paying: number;
};

function zeroBuckets(): Record<Bucket, number> {
  return Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Which months each church was paying in, from every plan payment ever made. */
export function payingMonths(payments: PaymentInput[]): Map<string, Set<MonthKey>> {
  const out = new Map<string, Set<MonthKey>>();
  for (const p of payments) {
    if (!p.churchId || !(p.amount > 0)) continue;
    const set = out.get(p.churchId) ?? new Set<MonthKey>();
    for (const s of paymentShares(p)) set.add(s.month);
    out.set(p.churchId, set);
  }
  return out;
}

/** The month each church first paid, for "new paying churches". */
export function firstPaidMonth(payments: PaymentInput[]): Map<string, MonthKey> {
  const out = new Map<string, MonthKey>();
  for (const p of payments) {
    if (!p.churchId || !(p.amount > 0)) continue;
    const m = monthOf(p.paidAt);
    const prev = out.get(p.churchId);
    if (!prev || m < prev) out.set(p.churchId, m);
  }
  return out;
}

/**
 * Of the churches paying in one month, the share that were not paying in the
 * next, averaged over the months given. Null when no month had anybody paying.
 */
export function monthlyChurn(paying: Map<string, Set<MonthKey>>, months: MonthKey[]): number | null {
  let lost = 0;
  let base = 0;
  for (const m of months) {
    const next = addMonths(m, 1);
    for (const set of paying.values()) {
      if (!set.has(m)) continue;
      base++;
      if (!set.has(next)) lost++;
    }
  }
  return base > 0 ? lost / base : null;
}

export function buildCostReport(input: CostInputs): CostReport {
  const months = input.months;
  const inRange = new Set(months);
  const churchIds = new Set(input.churches.map((c) => c.id));
  const known = (id: string | null): id is string => id != null && churchIds.has(id);
  const paying = payingMonths(input.payments);
  const firstPaid = firstPaidMonth(input.payments);

  const usageAt = new Map<string, UsageInput>();
  for (const u of input.usage) usageAt.set(`${u.churchId}|${u.month}`, u);

  // Per-church accumulators.
  type Acc = {
    subscription: number;
    walletSpend: number;
    otherIncome: number;
    costBy: Record<Bucket, number>;
    acquisition: number;
    smsPages: number;
    emails: number;
    meetingGb: number;
    activeMonths: number;
    revenueByMonth: Map<MonthKey, number>;
  };
  const acc = new Map<string, Acc>();
  for (const c of input.churches)
    acc.set(c.id, {
      subscription: 0,
      walletSpend: 0,
      otherIncome: 0,
      costBy: zeroBuckets(),
      acquisition: 0,
      smsPages: 0,
      emails: 0,
      meetingGb: 0,
      activeMonths: 0,
      revenueByMonth: new Map(),
    });
  const addRevenue = (id: string, m: MonthKey, n: number) => {
    const a = acc.get(id);
    if (!a) return;
    a.revenueByMonth.set(m, (a.revenueByMonth.get(m) ?? 0) + n);
  };

  const revenue = { subscriptions: 0, walletSms: 0, walletStorage: 0, churchOther: 0, otherIncome: 0, total: 0, capital: 0 };
  const monthRevenue = new Map<MonthKey, number>();
  const bumpMonthRevenue = (m: MonthKey, n: number) => monthRevenue.set(m, (monthRevenue.get(m) ?? 0) + n);

  // --- Revenue: plan payments, spread over the months they buy.
  for (const p of input.payments) {
    if (!(p.amount > 0)) continue;
    for (const s of paymentShares(p)) {
      if (!inRange.has(s.month)) continue;
      revenue.subscriptions += s.amount;
      bumpMonthRevenue(s.month, s.amount);
      if (known(p.churchId)) {
        acc.get(p.churchId)!.subscription += s.amount;
        addRevenue(p.churchId, s.month, s.amount);
      }
    }
  }

  // --- Revenue: what churches spent from their wallets.
  for (const w of input.walletSpend) {
    if (!inRange.has(w.month)) continue;
    if (w.category === "sms") revenue.walletSms += w.amount;
    else revenue.walletStorage += w.amount;
    bumpMonthRevenue(w.month, w.amount);
    if (known(w.churchId)) {
      acc.get(w.churchId)!.walletSpend += w.amount;
      addRevenue(w.churchId, w.month, w.amount);
    }
  }

  // --- Revenue: entered by hand. "wallet_offline" is set against credit given by hand below.
  const offlineWalletPaid = new Map<string, number>(); // `${church}|${month}`
  for (const e of input.income) {
    if (!inRange.has(e.month)) continue;
    const def = incomeDef(e.category);
    if (!def.profit) {
      revenue.capital += e.amountNgn;
      continue;
    }
    if (e.category === "wallet_offline" && e.churchId) {
      const k = `${e.churchId}|${e.month}`;
      offlineWalletPaid.set(k, (offlineWalletPaid.get(k) ?? 0) + e.amountNgn);
    }
    if (e.churchId && (e.category === "church_other" || e.category === "wallet_offline")) revenue.churchOther += e.amountNgn;
    else revenue.otherIncome += e.amountNgn;
    bumpMonthRevenue(e.month, e.amountNgn);
    if (known(e.churchId)) {
      acc.get(e.churchId)!.otherIncome += e.amountNgn;
      addRevenue(e.churchId, e.month, e.amountNgn);
    }
  }
  revenue.total = revenue.subscriptions + revenue.walletSms + revenue.walletStorage + revenue.churchOther + revenue.otherIncome;

  // --- Usage, per church per month, for the drivers.
  for (const u of input.usage) {
    if (!inRange.has(u.month) || !acc.has(u.churchId)) continue;
    const a = acc.get(u.churchId)!;
    a.smsPages += u.smsPages;
    a.emails += u.emails;
    a.meetingGb += u.meetingGb;
    if (u.active) a.activeMonths++;
  }

  const aiByChurchMonth = new Map<string, number>();
  for (const r of input.ai) if (r.churchId) aiByChurchMonth.set(`${r.churchId}|${r.month}`, (aiByChurchMonth.get(`${r.churchId}|${r.month}`) ?? 0) + r.amount);

  /** A month before this driver's usage was ever recorded: nobody was counting. */
  const unrecorded = (driver: CostDriver, m: MonthKey) => {
    const kind = DRIVER_USAGE[driver];
    if (!kind || !input.recordedFrom || !(kind in input.recordedFrom)) return false;
    const from = input.recordedFrom[kind];
    return from == null || m < from;
  };

  function weights(driver: CostDriver, m: MonthKey): Map<string, number> {
    if (unrecorded(driver, m)) driver = "all_churches";
    const w = new Map<string, number>();
    for (const c of input.churches) {
      if (c.joined > m) continue;
      const u = usageAt.get(`${c.id}|${m}`);
      let v = 0;
      switch (driver) {
        case "active_churches":
          v = u?.active ? 1 : 0;
          break;
        case "all_churches":
          v = 1;
          break;
        case "paying_churches":
          v = paying.get(c.id)?.has(m) ? 1 : 0;
          break;
        case "members":
          v = c.members;
          break;
        case "emails":
          v = u?.emails ?? 0;
          break;
        case "sms_pages":
          v = u?.smsPages ?? 0;
          break;
        case "storage":
          v = c.storageBytes;
          break;
        case "meetings":
          v = u?.meetingGb ?? 0;
          break;
        case "ai":
          v = aiByChurchMonth.get(`${c.id}|${m}`) ?? 0;
          break;
        case "revenue":
          v = acc.get(c.id)?.revenueByMonth.get(m) ?? 0;
          break;
        case "none":
          v = 0;
          break;
      }
      if (v > 0) w.set(c.id, v);
    }
    return w;
  }

  const lines: CostLine[] = [];
  const monthCost = new Map<MonthKey, { serve: number; all: number }>();
  let untraced = 0;
  const charge = (bucket: Bucket, m: MonthKey, amount: number, churchId: string | null) => {
    const mc = monthCost.get(m) ?? { serve: 0, all: 0 };
    mc.all += amount;
    if (SERVE_BUCKETS.includes(bucket)) mc.serve += amount;
    monthCost.set(m, mc);
    if (churchId && acc.has(churchId)) {
      if (bucket === "acquisition") acc.get(churchId)!.acquisition += amount;
      else acc.get(churchId)!.costBy[bucket] += amount;
    }
  };

  // --- Entered costs, shared by their drivers.
  let fixedTotal = 0;
  for (const item of input.items) {
    const def = categoryDef(item.category);
    let total = 0;
    let itemUntraced = 0;
    const guessed: MonthKey[] = [];
    for (const m of months) {
      const amount = itemCostInMonth(item, m);
      if (amount === 0) continue;
      if (SERVE_BUCKETS.includes(def.bucket) && item.driver !== "none" && unrecorded(item.driver, m)) guessed.push(m);
      total += amount;
      fixedTotal += amount;
      if (item.driver === "none" || !SERVE_BUCKETS.includes(def.bucket)) {
        charge(def.bucket, m, amount, null);
        continue;
      }
      const { byChurch, untraced: left } = shareOut(amount, weights(item.driver, m));
      for (const [id, n] of byChurch) charge(def.bucket, m, n, id);
      if (left) {
        charge(def.bucket, m, left, null);
        untraced += left;
        itemUntraced += left;
      }
    }
    if (total > 0)
      lines.push({
        key: `item:${item.id}`,
        label: item.name,
        bucket: def.bucket,
        amount: total,
        basis: "entered",
        itemId: item.id,
        detail:
          [
            item.foreign ? "Priced in dollars: moves with the exchange rate" : null,
            guessed.length
              ? `${guessed.map((m) => monthLabel(m)).join(", ")}: usage was not recorded yet, so shared between every church`
              : null,
          ]
            .filter(Boolean)
            .join(". ") || undefined,
        untraced: itemUntraced || undefined,
      });
  }

  // --- SMS: pages each church sent, at what a page costs us.
  let smsPages = 0;
  let smsAttributed = 0;
  const smsAttributedByMonth = new Map<MonthKey, number>();
  for (const u of input.usage) {
    if (!inRange.has(u.month) || !(u.smsPages > 0)) continue;
    smsPages += u.smsPages;
    if (input.smsUnitCost == null) continue;
    const cost = u.smsPages * input.smsUnitCost;
    smsAttributed += cost;
    smsAttributedByMonth.set(u.month, (smsAttributedByMonth.get(u.month) ?? 0) + cost);
    charge("sms", u.month, cost, acc.has(u.churchId) ? u.churchId : null);
  }
  if (smsAttributed > 0)
    lines.push({
      key: "sms:pages",
      label: "SMS pages sent (Termii)",
      bucket: "sms",
      amount: smsAttributed,
      basis: "measured",
      detail: `${smsPages.toLocaleString()} pages at ₦${input.smsUnitCost} each`,
    });

  // What the Termii balance says beyond that: codes, platform messages, or a wrong cost per page.
  let measured = 0;
  let measuredMonths = 0;
  let attributedInMeasured = 0;
  let smsGap = 0;
  for (const t of input.termiiMeasured) {
    if (!inRange.has(t.month)) continue;
    measured += t.spent;
    measuredMonths++;
    const attributed = smsAttributedByMonth.get(t.month) ?? 0;
    attributedInMeasured += attributed;
    const extra = t.spent - attributed;
    if (extra > 0) {
      smsGap += extra;
      charge("sms", t.month, extra, null);
    }
  }
  if (smsGap > 0) {
    untraced += smsGap;
    lines.push({
      key: "sms:gap",
      label: "SMS Termii charged that no church sent",
      bucket: "sms",
      amount: smsGap,
      basis: "measured",
      detail: "Sign-in codes and platform messages, or a cost per page set too low",
    });
  }

  // --- AI, to the nano-dollar.
  let aiChurch = 0;
  let aiPlatform = 0;
  for (const r of input.ai) {
    if (!inRange.has(r.month) || !(r.amount > 0)) continue;
    if (known(r.churchId)) {
      aiChurch += r.amount;
      charge("ai", r.month, r.amount, r.churchId);
    } else {
      aiPlatform += r.amount;
      charge("ai", r.month, r.amount, null);
    }
  }
  if (aiChurch > 0) lines.push({ key: "ai:church", label: "AI used by churches", bucket: "ai", amount: aiChurch, basis: "measured" });
  if (aiPlatform > 0) {
    untraced += aiPlatform;
    lines.push({
      key: "ai:platform",
      label: "AI used by the platform",
      bucket: "ai",
      amount: aiPlatform,
      basis: "measured",
      detail: "Briefings, blog drafts and questions asked from the admin",
    });
  }

  // --- Meetings: Cloudflare egress past the free allowance, shared by data used.
  let meetingCost = 0;
  for (const m of months) {
    let gb = 0;
    const w = new Map<string, number>();
    for (const u of input.usage)
      if (u.month === m && u.meetingGb > 0) {
        gb += u.meetingGb;
        w.set(u.churchId, (w.get(u.churchId) ?? 0) + u.meetingGb);
      }
    const bill = meetingBillUsd(gb) * input.ngnPerUsd;
    if (!(bill > 0)) continue;
    meetingCost += bill;
    const { byChurch, untraced: left } = shareOut(bill, w);
    for (const [id, n] of byChurch) charge("meetings", m, n, id);
    if (left) charge("meetings", m, left, null);
  }
  if (meetingCost > 0)
    lines.push({
      key: "meetings:egress",
      label: "Meeting video (Cloudflare)",
      bucket: "meetings",
      amount: meetingCost,
      basis: "measured",
      detail: `Past the free ${MEETING_FREE_GB.toLocaleString()} GB a month`,
    });

  // --- Payment fees: per payment, Paystack's own figure where we have it.
  const fees = { actual: 0, estimated: 0, estimatedCount: 0 };
  const chargeFee = (churchId: string | null, paidAt: Date, f: { amount: number; estimated: boolean }) => {
    const m = monthOf(paidAt);
    if (!inRange.has(m) || !(f.amount > 0)) return;
    if (f.estimated) {
      fees.estimated += f.amount;
      fees.estimatedCount++;
    } else fees.actual += f.amount;
    charge("payments", m, f.amount, known(churchId) ? churchId : null);
  };
  for (const p of input.payments) chargeFee(p.churchId, p.paidAt, gatewayFee(p));
  for (const t of input.topups) chargeFee(t.churchId, t.paidAt, gatewayFee({ gateway: "paystack", amount: t.amount, fee: t.fee, international: false }));
  if (fees.actual > 0) lines.push({ key: "fees:actual", label: "Paystack fees", bucket: "payments", amount: fees.actual, basis: "measured" });
  if (fees.estimated > 0)
    lines.push({
      key: "fees:estimated",
      label: "Paystack fees (estimated)",
      bucket: "payments",
      amount: fees.estimated,
      basis: "estimated",
      detail: `${fees.estimatedCount} payment${fees.estimatedCount === 1 ? "" : "s"} from before the actual fee was kept`,
    });

  // --- Winning churches: Partner commission and referral credit.
  let partner = 0;
  for (const r of input.partnerCommission) {
    if (!inRange.has(r.month) || r.amount === 0) continue;
    partner += r.amount;
    charge("acquisition", r.month, r.amount, known(r.churchId) ? r.churchId : null);
  }
  if (partner !== 0) lines.push({ key: "acq:partner", label: "Partner commission", bucket: "acquisition", amount: partner, basis: "measured" });

  let referral = 0;
  let byHand = 0;
  for (const r of input.creditsGiven) {
    if (!inRange.has(r.month) || r.amount === 0) continue;
    if (r.kind === "referral") {
      referral += r.amount;
      charge("acquisition", r.month, r.amount, known(r.churchId) ? r.churchId : null);
      continue;
    }
    // Credit added by hand that the church paid for is not a gift.
    const k = `${r.churchId}|${r.month}`;
    const paid = offlineWalletPaid.get(k) ?? 0;
    const gift = Math.max(0, r.amount - paid);
    if (paid) offlineWalletPaid.set(k, Math.max(0, paid - r.amount));
    if (gift > 0) {
      byHand += gift;
      charge("overhead", r.month, gift, known(r.churchId) ? r.churchId : null);
    }
  }
  if (referral > 0) lines.push({ key: "acq:referral", label: "Referral credit", bucket: "acquisition", amount: referral, basis: "measured" });
  if (byHand > 0)
    lines.push({
      key: "over:credit",
      label: "Wallet credit added by hand",
      bucket: "overhead",
      amount: byHand,
      basis: "measured",
      detail: "Counted as given away unless you record that the church paid for it",
    });

  // --- Totals.
  const byBucket = zeroBuckets();
  for (const l of lines) byBucket[l.bucket] += l.amount;
  const serve = SERVE_BUCKETS.reduce((n, b) => n + byBucket[b], 0);
  const acquisition = byBucket.acquisition;
  const overhead = byBucket.overhead;
  const totalCost = serve + acquisition + overhead;
  const grossProfit = revenue.total - serve;
  const profit = revenue.total - totalCost;

  const series: MonthPoint[] = months.map((m) => {
    const r = monthRevenue.get(m) ?? 0;
    const c = monthCost.get(m) ?? { serve: 0, all: 0 };
    return { month: m, revenue: round2(r), serve: round2(c.serve), costs: round2(c.all), profit: round2(r - c.all) };
  });

  // --- Per church.
  const lastMonth = months[months.length - 1];
  /*
   * Paying at the end of the period. In the running month a church that pays
   * on the 20th has not paid yet on the 5th, so last month's payment counts.
   */
  const payingAtEnd = (set: Set<MonthKey> | undefined) =>
    !!set && !!lastMonth && (set.has(lastMonth) || (lastMonth === input.currentMonth && set.has(addMonths(lastMonth, -1))));
  const churches: ChurchRow[] = input.churches.map((c) => {
    const a = acc.get(c.id)!;
    const rev = a.subscription + a.walletSpend + a.otherIncome;
    const cost = SERVE_BUCKETS.reduce((n, b) => n + a.costBy[b], 0);
    const isPaying = payingAtEnd(paying.get(c.id));
    const status: ChurchStatus = isPaying ? "paying" : c.onTrial ? "trial" : "free";
    return {
      id: c.id,
      name: c.name,
      planKey: c.planKey,
      planLabel: c.planLabel,
      status,
      channel: c.channel,
      revenue: rev,
      subscription: a.subscription,
      walletSpend: a.walletSpend,
      otherIncome: a.otherIncome,
      cost,
      costBy: a.costBy,
      acquisition: a.acquisition,
      margin: rev - cost,
      marginPct: pctOf(rev - cost, rev),
      smsPages: a.smsPages,
      emails: a.emails,
      meetingGb: a.meetingGb,
      storageBytes: c.storageBytes,
      members: c.members,
      activeMonths: a.activeMonths,
    };
  });

  const n = Math.max(1, months.length);
  const groupBy = (keyOf: (r: ChurchRow) => string, labelOf: (r: ChurchRow) => string): GroupRow[] => {
    const g = new Map<string, GroupRow>();
    for (const r of churches) {
      const k = keyOf(r);
      const row = g.get(k) ?? { key: k, label: labelOf(r), churches: 0, revenue: 0, cost: 0, margin: 0, marginPct: null, revenuePerChurchMonth: 0, costPerChurchMonth: 0 };
      row.churches++;
      row.revenue += r.revenue;
      row.cost += r.cost;
      g.set(k, row);
    }
    return [...g.values()]
      .map((row) => ({
        ...row,
        margin: row.revenue - row.cost,
        marginPct: pctOf(row.revenue - row.cost, row.revenue),
        revenuePerChurchMonth: row.revenue / row.churches / n,
        costPerChurchMonth: row.cost / row.churches / n,
      }))
      .sort((x, y) => y.revenue - x.revenue || y.cost - x.cost);
  };
  const STATUS_LABEL: Record<ChurchStatus, string> = { paying: "Paying", trial: "On free trial", free: "Not paying" };
  const plans = groupBy((r) => r.planKey, (r) => r.planLabel);
  const statuses = groupBy((r) => r.status, (r) => STATUS_LABEL[r.status]);

  const featureRevenue: Partial<Record<Bucket, number>> = {
    core: revenue.subscriptions + revenue.churchOther,
    sms: revenue.walletSms,
    media: revenue.walletStorage,
  };
  const features = SERVE_BUCKETS.map((b) => ({ bucket: b, label: BUCKET_LABEL[b], cost: byBucket[b], revenue: featureRevenue[b] ?? 0 }));

  // --- SMS economics.
  const smsCost = byBucket.sms;
  const sms = {
    pages: smsPages,
    revenue: revenue.walletSms,
    cost: smsCost,
    unitCost: input.smsUnitCost,
    price: input.smsPrice,
    markupPct: input.smsUnitCost && input.smsUnitCost > 0 ? Math.round(((input.smsPrice - input.smsUnitCost) / input.smsUnitCost) * 100) : null,
    measured: measuredMonths > 0 ? measured : null,
    measuredMonths,
    gap: measuredMonths > 0 ? measured - attributedInMeasured : null,
  };

  // --- Acquisition: who started paying in these months, and what winning them cost.
  const channelOf = new Map(input.churches.map((c) => [c.id, c.channel]));
  const newPayingByChannel = new Map<string, number>();
  let newPaying = 0;
  for (const [id, m] of firstPaid) {
    if (!inRange.has(m) || !channelOf.has(id)) continue;
    newPaying++;
    const ch = channelOf.get(id)!;
    newPayingByChannel.set(ch, (newPayingByChannel.get(ch) ?? 0) + 1);
  }
  const spendByChannel = new Map<string, number>();
  let untaggedSpend = 0;
  for (const item of input.items) {
    if (categoryDef(item.category).bucket !== "acquisition") continue;
    const spent = months.reduce((s, m) => s + itemCostInMonth(item, m), 0);
    if (!spent) continue;
    const ch = item.channel?.trim().toLowerCase();
    if (ch) spendByChannel.set(ch, (spendByChannel.get(ch) ?? 0) + spent);
    else untaggedSpend += spent;
  }
  if (partner) spendByChannel.set("partner", (spendByChannel.get("partner") ?? 0) + partner);
  if (referral) spendByChannel.set("referral", (spendByChannel.get("referral") ?? 0) + referral);
  const channels = new Set([...spendByChannel.keys(), ...newPayingByChannel.keys()]);
  const byChannel: ChannelRow[] = [...channels]
    .map((ch) => {
      const spend = spendByChannel.get(ch) ?? 0;
      const got = newPayingByChannel.get(ch) ?? 0;
      return { channel: ch, spend, newPaying: got, cac: got > 0 ? spend / got : null };
    })
    .sort((a, b) => b.newPaying - a.newPaying || b.spend - a.spend);

  // Gross profit per paying church per month: what one more of them is worth.
  let payingRevenue = 0;
  let payingServe = 0;
  let payingChurchMonths = 0;
  for (const c of input.churches) {
    const set = paying.get(c.id);
    if (!set) continue;
    const a = acc.get(c.id)!;
    for (const m of months) {
      if (!set.has(m)) continue;
      payingChurchMonths++;
    }
    if (months.some((m) => set.has(m))) {
      payingRevenue += a.subscription + a.walletSpend + a.otherIncome;
      payingServe += SERVE_BUCKETS.reduce((s, b) => s + a.costBy[b], 0);
    }
  }
  const grossPerPayingMonth = payingChurchMonths > 0 ? (payingRevenue - payingServe) / payingChurchMonths : null;
  const cac = newPaying > 0 ? acquisition / newPaying : null;
  /*
   * Churn is a long-run figure, so it is read over the last six FINISHED
   * month-to-month steps whatever range is on screen. A church that pays on
   * the 20th has not paid for this month yet on the 5th, so a step into the
   * running month would read as everybody leaving.
   */
  const anchor = input.currentMonth ?? (lastMonth ? addMonths(lastMonth, 1) : null);
  const churn = anchor ? monthlyChurn(paying, monthRange(addMonths(anchor, -7), addMonths(anchor, -2))) : null;
  const ltv = grossPerPayingMonth != null && grossPerPayingMonth > 0 && churn != null && churn > 0 ? grossPerPayingMonth / churn : null;

  // --- Break-even: bills that do not grow with churches, against what a paying church leaves.
  const payingNow = input.churches.filter((c) => payingAtEnd(paying.get(c.id))).length;
  const fixedPerMonth = fixedTotal / n;
  let measuredServePaying = 0;
  for (const c of input.churches) {
    const set = paying.get(c.id);
    if (!set || !months.some((m) => set.has(m))) continue;
    const a = acc.get(c.id)!;
    // Their measured costs only (SMS, AI, meetings, fees): their share of the bills is the fixed part.
    measuredServePaying += a.costBy.sms + a.costBy.ai + a.costBy.meetings + a.costBy.payments;
  }
  const contributionPerPaying = payingChurchMonths > 0 ? (payingRevenue - measuredServePaying) / payingChurchMonths : null;
  const payingNeeded = contributionPerPaying != null && contributionPerPaying > 0 ? Math.ceil(fixedPerMonth / contributionPerPaying) : null;

  return {
    months,
    partial: input.currentMonth != null && inRange.has(input.currentMonth),
    revenue,
    lines: lines.sort((a, b) => b.amount - a.amount),
    byBucket,
    serve,
    acquisition,
    overhead,
    totalCost,
    grossProfit,
    grossMarginPct: pctOf(grossProfit, revenue.total),
    profit,
    marginPct: pctOf(profit, revenue.total),
    untraced,
    series,
    churches: churches.sort((a, b) => a.margin - b.margin),
    plans,
    statuses,
    features,
    sms,
    acquisitionStats: {
      spend: acquisition,
      newPaying,
      cac,
      byChannel,
      untaggedSpend,
      grossPerPayingMonth,
      paybackMonths: cac != null && grossPerPayingMonth != null && grossPerPayingMonth > 0 ? cac / grossPerPayingMonth : null,
      monthlyChurn: churn,
      ltv,
      ltvToCac: ltv != null && cac != null && cac > 0 ? ltv / cac : null,
    },
    breakEven: { fixedPerMonth, contributionPerPaying, payingNow, payingNeeded },
    fees,
    paying: payingNow,
  };
}

/* ------------------------------------------------------------------ *
 * What Termii's own balance says
 * ------------------------------------------------------------------ */

/** A reading gap longer than this and the month cannot be vouched for. */
export const TERMII_MAX_GAP_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Money that left the Termii balance in each month, from the readings the
 * health cron takes every 30 minutes. A fall between two readings is spend;
 * a rise is a top-up and is left out. A month counts only when readings
 * cover it from start to end (or to now) with no gap over two days, because
 * a month with a hole in it would under-read and look like a saving.
 *
 * The check this makes possible: Termii's own figure against pages-sent
 * times the cost per page. If they disagree, one of them is wrong.
 */
export function termiiSpendByMonth(
  readings: { at: Date; balance: number }[],
  now: Date,
): { month: MonthKey; spent: number; toppedUp: number }[] {
  const sorted = [...readings].filter((r) => Number.isFinite(r.balance)).sort((a, b) => a.at.getTime() - b.at.getTime());
  type M = { spent: number; toppedUp: number; ok: boolean; first: number; last: number };
  const by = new Map<MonthKey, M>();
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const m = monthOf(b.at);
    const row = by.get(m) ?? { spent: 0, toppedUp: 0, ok: true, first: a.at.getTime(), last: b.at.getTime() };
    const delta = b.balance - a.balance;
    if (delta < 0) row.spent += -delta;
    else row.toppedUp += delta;
    if (b.at.getTime() - a.at.getTime() > TERMII_MAX_GAP_MS) row.ok = false;
    row.first = Math.min(row.first, a.at.getTime());
    row.last = Math.max(row.last, b.at.getTime());
    by.set(m, row);
  }
  const current = monthOf(now);
  const out: { month: MonthKey; spent: number; toppedUp: number }[] = [];
  for (const [m, row] of by) {
    // The month's first and last moments, in Lagos time.
    const start = Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1) - LAGOS_OFFSET_MS;
    const end = m === current ? now.getTime() : Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1) - LAGOS_OFFSET_MS;
    if (!row.ok || row.first > start + TERMII_MAX_GAP_MS || row.last < end - TERMII_MAX_GAP_MS) continue;
    out.push({ month: m, spent: round2(row.spent), toppedUp: round2(row.toppedUp) });
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : 1));
}
