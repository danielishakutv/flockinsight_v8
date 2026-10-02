/**
 * The rules of a group contribution, with no database and no server imports.
 *
 * Everything here is pure, for one reason: this module decides whether money
 * counts. Whether an entry is confirmed, what somebody still owes, what is left
 * in the pot after a hand-over. Those are the figures a department will argue
 * over in a WhatsApp group, and an argument is a bad place to discover that the
 * rule lived inside a React component and was never tested.
 *
 * Safe to import from a client component, a server action, a cron job and a
 * test, which is the point — one implementation of each rule.
 */

export type ContributionKind = "equal" | "open" | "gift";
export type ContributionStatus = "draft" | "open" | "closed" | "settled";
export type ContributionVisibility = "private" | "summary" | "detailed";
export type EntryStatus = "pending" | "confirmed" | "disputed" | "rejected";
export type EntrySource = "recorded" | "self";
export type PayoutKind = "handover" | "expense" | "withdrawal" | "refund";
export type PayoutStatus = "pending" | "approved" | "rejected";
export type ApprovalDecision = "confirm" | "dispute";

/* ============================================================
 * Vocabulary
 * ========================================================== */

export const CONTRIBUTION_KINDS: {
  id: ContributionKind;
  label: string;
  blurb: string;
  /** The question the create form leads with for this kind. */
  example: string;
}[] = [
  {
    id: "equal",
    label: "Everyone gives the same",
    blurb: "A set amount from each person — a levy, a dues, an assessment.",
    example: "Choir uniform levy — 5,000 each",
  },
  {
    id: "open",
    label: "Any amount, toward a goal",
    blurb: "People give what they can until the total is reached.",
    example: "Youth camp transport — 300,000 needed",
  },
  {
    id: "gift",
    label: "Bless someone",
    blurb: "A gift for one person, from the whole group.",
    example: "Pastor's birthday gift",
  },
];

export const KIND_LABEL: Record<ContributionKind, string> = {
  equal: "Equal shares",
  open: "Open collection",
  gift: "Group gift",
};

export const STATUS_LABEL: Record<ContributionStatus, string> = {
  draft: "Draft",
  open: "Collecting",
  closed: "Closed",
  settled: "Settled",
};

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  disputed: "Disputed",
  rejected: "Not counted",
};

export const PAYOUT_KINDS: { id: PayoutKind; label: string; blurb: string }[] = [
  {
    id: "handover",
    label: "Handed to the church",
    blurb: "The money went to the church. This one can post to Finance.",
  },
  {
    id: "expense",
    label: "Spent on the purpose",
    blurb: "Paid for the thing the group was collecting for.",
  },
  {
    id: "withdrawal",
    label: "Withdrawn / held by a person",
    blurb: "Taken out of the account and held, not yet spent.",
  },
  { id: "refund", label: "Refunded", blurb: "Returned to the people who gave." },
];

export const PAYOUT_KIND_LABEL: Record<PayoutKind, string> = Object.fromEntries(
  PAYOUT_KINDS.map((p) => [p.id, p.label]),
) as Record<PayoutKind, string>;

export const VISIBILITY_OPTIONS: {
  id: ContributionVisibility;
  label: string;
  blurb: string;
}[] = [
  {
    id: "detailed",
    label: "Everyone sees everything",
    blurb: "Totals, every contributor and every amount. Stops the arguments.",
  },
  {
    id: "summary",
    label: "Totals only",
    blurb: "How much has come in and from how many people — no names, no amounts.",
  },
  {
    id: "private",
    label: "No public link",
    blurb: "Only your team, inside FlockInsight.",
  },
];

export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  transfer: "Transfer",
  card: "Card",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};

/* ============================================================
 * Whether money counts
 * ========================================================== */

/**
 * The standing of one entry, from the votes on it.
 *
 * Three rules, in order:
 *
 *   - Rejected is final. Somebody decided this was not a real payment. It stays
 *     on the record and is never counted.
 *   - A dispute raises the bar instead of settling the question. One person
 *     saying "that is not what I paid" must not delete a payment, and must not
 *     be overridden by the one person who wrote the figure down either. So a
 *     disputed entry needs at least TWO people to confirm it, and more of them
 *     than dispute it. This is the rule the user asked for in plain words, and
 *     it is why `required` is a floor, not the whole answer.
 *   - Otherwise it is the pot's own threshold: 1 for an ordinary group, 2 where
 *     the committee wants the recorder checked by somebody else.
 *
 * `confirmations` and `disputes` are counts of DISTINCT people — the unique
 * index on contribution_approval is what makes that true, not this function.
 */
export function deriveEntryStatus(opts: {
  rejected: boolean;
  confirmations: number;
  disputes: number;
  required: number;
}): EntryStatus {
  if (opts.rejected) return "rejected";
  const required = Math.max(1, Math.floor(opts.required || 1));

  if (opts.disputes > 0) {
    const bar = Math.max(2, required);
    return opts.confirmations >= bar && opts.confirmations > opts.disputes
      ? "confirmed"
      : "disputed";
  }
  return opts.confirmations >= required ? "confirmed" : "pending";
}

/** Money out needs its own threshold, and no dispute path — see payouts below. */
export function derivePayoutStatus(opts: {
  rejected: boolean;
  approvals: number;
  disputes: number;
  required: number;
}): PayoutStatus {
  if (opts.rejected) return "rejected";
  const required = Math.max(1, Math.floor(opts.required || 1));
  // A single objection holds money in. Unlike an entry, nothing is lost by
  // waiting: the cash has not moved in the ledger until this is approved.
  if (opts.disputes > 0) return "pending";
  return opts.approvals >= required ? "approved" : "pending";
}

/** Only confirmed entries are money. Everything else is a claim. */
export function countsTowardTotal(status: EntryStatus): boolean {
  return status === "confirmed";
}

/* ============================================================
 * Totals
 * ========================================================== */

export type EntryLike = { amount: number; status: EntryStatus };
export type PayoutLike = { amount: number; status: PayoutStatus };

export type PotTotals = {
  /** Confirmed money in. */
  raised: number;
  /** Claimed but not yet confirmed — shown separately, never added in. */
  pending: number;
  /** Under dispute. Part of `pending` in spirit, called out on its own. */
  disputed: number;
  /** Approved money out. */
  paidOut: number;
  /** Approved out, pending out — what is still waiting on signatures. */
  pendingOut: number;
  /** What the group should still be holding. */
  balance: number;
};

export function potTotals(entries: EntryLike[], payouts: PayoutLike[] = []): PotTotals {
  let raised = 0;
  let pending = 0;
  let disputed = 0;
  for (const e of entries) {
    const amount = Number(e.amount) || 0;
    if (e.status === "confirmed") raised += amount;
    else if (e.status === "pending") pending += amount;
    else if (e.status === "disputed") disputed += amount;
  }

  let paidOut = 0;
  let pendingOut = 0;
  for (const p of payouts) {
    const amount = Number(p.amount) || 0;
    if (p.status === "approved") paidOut += amount;
    else if (p.status === "pending") pendingOut += amount;
  }

  return {
    raised,
    pending,
    disputed,
    paidOut,
    pendingOut,
    // Deliberately confirmed-minus-approved. A balance that counted unconfirmed
    // claims would be a balance nobody can find in the account.
    balance: raised - paidOut,
  };
}

/** Percent of the goal, or null when the pot has no goal to be a percent of. */
export function progressPct(raised: number, target: number | null): number | null {
  if (!target || target <= 0) return null;
  return Math.min(100, Math.round((raised / target) * 100));
}

/**
 * What one person is expected to give: their own figure if set, otherwise the
 * pot's. Zero is a real answer (somebody exempted) and must survive, which is
 * why this tests for null rather than falsiness.
 */
export function expectedFor(
  contributorExpected: number | null | undefined,
  potPerPerson: number | null | undefined,
): number | null {
  if (contributorExpected !== null && contributorExpected !== undefined)
    return Number(contributorExpected);
  if (potPerPerson !== null && potPerPerson !== undefined) return Number(potPerPerson);
  return null;
}

/** Still to pay. Never negative — somebody who overpaid owes nothing, not less. */
export function outstandingFor(expected: number | null, paid: number): number {
  if (expected === null) return 0;
  return Math.max(0, expected - paid);
}

export type PersonSummary = {
  expected: number | null;
  paid: number;
  pending: number;
  outstanding: number;
  /** Fully paid up (or nothing was expected and they gave something). */
  settled: boolean;
};

export function summarisePerson(opts: {
  expected: number | null;
  entries: EntryLike[];
}): PersonSummary {
  const t = potTotals(opts.entries);
  const outstanding = outstandingFor(opts.expected, t.raised);
  return {
    expected: opts.expected,
    paid: t.raised,
    pending: t.pending + t.disputed,
    outstanding,
    settled: opts.expected === null ? t.raised > 0 : outstanding === 0,
  };
}

/**
 * The goal when none was typed in.
 *
 * An equal-shares pot with 40 people at 5,000 each has a target of 200,000
 * whether or not anyone wrote it down, and showing no progress bar on such an
 * obvious sum is the kind of small blankness that makes software feel stupid.
 */
export function effectiveTarget(opts: {
  targetAmount: number | null;
  perPersonAmount: number | null;
  /** Sum of every contributor's expected amount, where the roster has them. */
  expectedTotal?: number | null;
}): number | null {
  if (opts.targetAmount && opts.targetAmount > 0) return opts.targetAmount;
  if (opts.expectedTotal && opts.expectedTotal > 0) return opts.expectedTotal;
  return null;
}

/**
 * "55,000 to go — about 11 people at 5,000."
 *
 * Returns the number of people, not the sentence, so the wording stays with the
 * UI and the arithmetic stays here. Null when there is nothing useful to say.
 */
export function peopleStillNeeded(
  remaining: number,
  perPerson: number | null,
): number | null {
  if (remaining <= 0) return null;
  if (!perPerson || perPerson <= 0) return null;
  return Math.ceil(remaining / perPerson);
}

/* ============================================================
 * Dates
 * ========================================================== */

/**
 * Whole days from today until a due date. Negative once it has passed, null
 * when there is no deadline.
 *
 * Compared as calendar dates in UTC rather than by subtracting timestamps: a
 * deadline is a day, not a moment, and a church in Lagos must not be told
 * "1 day left" at 23:00 on the day itself because the clocks disagree by an
 * hour. Both sides are flattened to midnight, so the answer is a day count.
 */
export function daysUntil(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return null;
  return Math.round((due - now) / 86_400_000);
}

/** Plain words for a countdown. Null when there is no deadline. */
export function dueLabel(dueDate: string | null, today: string): string | null {
  const days = daysUntil(dueDate, today);
  if (days === null) return null;
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  if (days > 1) return `${days} days left`;
  if (days === -1) return "1 day overdue";
  return `${Math.abs(days)} days overdue`;
}

/* ============================================================
 * Identity — the names a leader types in
 * ========================================================== */

/**
 * A name reduced to what two spellings of the same person have in common:
 * lower case, no punctuation, single spaces, no honorifics.
 *
 * Honorifics are stripped because in a Nigerian church register the same woman
 * is "Sis. Grace Udo", "Sister Grace Udo" and "Grace Udo" in three different
 * places, and a match that misses all three is a match nobody trusts. This is
 * deliberately NOT fuzzy: it finds spellings that are the same, never ones that
 * are similar. A wrong merge moves somebody's money onto another person's
 * record, so "exact after tidying" is the only safe rule to apply without
 * asking — which is what the user asked for, and why every suggestion is still
 * confirmed by a human before anything is linked.
 */
const HONORIFICS = new Set([
  "mr",
  "mrs",
  "miss",
  "ms",
  "dr",
  "prof",
  "rev",
  "revd",
  "pst",
  "pastor",
  "bro",
  "brother",
  "sis",
  "sister",
  "elder",
  "deacon",
  "deaconess",
  "evang",
  "evangelist",
  "apostle",
  "bishop",
  "mama",
  "papa",
  "chief",
  "engr",
  "barr",
  "alhaji",
  "hajia",
]);

export function nameKey(input: string | null | undefined): string {
  if (!input) return "";
  const words = input
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so "Adéyẹmí" and "Adeyemi" are one name.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !HONORIFICS.has(w));
  // Sorted, so "Grace Udo" and "Udo Grace" are the same key. Surname-first is
  // normal in half the registers this will ever see.
  return words.sort().join(" ");
}

/**
 * The last ten digits of a phone number, which is what actually identifies a
 * Nigerian line however it was typed: 08031234567, +2348031234567 and
 * 234 803 123 4567 all reduce to 8031234567.
 *
 * Ten rather than the whole string, because the country code is the part people
 * leave off. Null for anything too short to be a number.
 */
export function phoneKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export function emailKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

/** Why a member was suggested, strongest first. */
export type MatchReason = "email" | "phone" | "name";

export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  email: "Same email address",
  phone: "Same phone number",
  name: "Exactly the same name",
};

/**
 * How strongly to trust a suggestion.
 *
 * An email or a phone number is a near-certainty — people do not share them.
 * A name is a genuine guess: a church of two thousand has four Blessing
 * Okonkwos, so a name match is offered and never applied without a person
 * saying yes. The ordering is what puts the safe suggestions at the top of the
 * screen, where they get accepted, instead of mixed in with the risky ones.
 */
export const MATCH_CONFIDENCE: Record<MatchReason, number> = {
  email: 3,
  phone: 2,
  name: 1,
};

export function bestReason(reasons: MatchReason[]): MatchReason | null {
  let best: MatchReason | null = null;
  for (const r of reasons) {
    if (!best || MATCH_CONFIDENCE[r] > MATCH_CONFIDENCE[best]) best = r;
  }
  return best;
}

/** Which of a contributor's details line up with a member's. */
export function matchReasons(
  contributor: { name: string; phone?: string | null; email?: string | null },
  candidate: {
    firstName: string;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
  },
): MatchReason[] {
  const reasons: MatchReason[] = [];

  const cEmail = emailKey(contributor.email);
  if (cEmail && cEmail === emailKey(candidate.email)) reasons.push("email");

  const cPhone = phoneKey(contributor.phone);
  if (cPhone && cPhone === phoneKey(candidate.phone)) reasons.push("phone");

  const cName = nameKey(contributor.name);
  const memberName = nameKey(
    [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
  );
  // A single word is not an identification. "Grace" matching "Grace" would
  // suggest a merge for half the women in the church.
  if (cName && cName === memberName && cName.includes(" ")) reasons.push("name");

  return reasons;
}

/** Split a typed-in full name the way a register expects it. */
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || null,
  };
}

/* ============================================================
 * Receipts
 * ========================================================== */

/**
 * What a proof file may be, and how big.
 *
 * Narrow on purpose. A receipt is a photo of a teller or a bank's PDF; nothing
 * else needs to be accepted, and every extra type is a type we store, serve and
 * pay for. Eight megabytes is roughly what a modern phone camera produces at
 * full size, and the image is re-encoded down to a couple of hundred kilobytes
 * on the way in (see RECEIPT_TRANSFORM in lib/cloudinary.ts) — so what a church
 * is billed for is the readable receipt, not the 6 MB original.
 */
export const PROOF_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export const PROOF_MAX_BYTES = 8 * 1024 * 1024;
/** A PDF is stored as-is, so its ceiling is the ceiling. */
export const PROOF_PDF_MAX_BYTES = 3 * 1024 * 1024;

export function proofRejection(file: { type: string; size: number }): string | null {
  if (!(PROOF_MIME as readonly string[]).includes(file.type))
    return "Please attach a photo or a PDF of the receipt.";
  if (file.type === "application/pdf" && file.size > PROOF_PDF_MAX_BYTES)
    return "That PDF is too large. Please keep receipts under 3 MB.";
  if (file.size > PROOF_MAX_BYTES)
    return "That file is too large. Please keep receipts under 8 MB.";
  return null;
}

/**
 * How long a receipt is kept after the pot is settled, unless pinned.
 *
 * A year, because that covers any argument that is still live, and because
 * receipts are the one thing in this module that costs money every month it
 * exists. A church that needs to keep its paperwork longer ticks "keep
 * receipts" on the pot and nothing is ever released.
 */
export const PROOF_RETENTION_DAYS = 365;

/* ============================================================
 * Sharing
 * ========================================================== */

/**
 * The message that gets pasted into a WhatsApp group.
 *
 * This is the actual distribution channel for this feature, so the text is
 * treated as part of the product rather than left to whatever the browser's
 * share sheet decides. It leads with the number, because that is what people
 * open the message for.
 */
export function shareMessage(opts: {
  title: string;
  raised: string;
  target: string | null;
  contributors: number;
  url: string;
  dueLabel?: string | null;
}): string {
  const lines = [`*${opts.title}*`];
  lines.push(
    opts.target
      ? `${opts.raised} of ${opts.target} so far — from ${opts.contributors} ${opts.contributors === 1 ? "person" : "people"}.`
      : `${opts.raised} so far — from ${opts.contributors} ${opts.contributors === 1 ? "person" : "people"}.`,
  );
  if (opts.dueLabel) lines.push(opts.dueLabel + ".");
  lines.push("");
  lines.push(`See every contribution, and record yours: ${opts.url}`);
  return lines.join("\n");
}

export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** The public path for a pot. One place, so a link in an email cannot drift. */
export function contributionPath(slug: string): string {
  return `/p/${slug}`;
}

/* ============================================================
 * Validation shared by the admin form and the public form
 * ========================================================== */

/** Parse a typed amount: "5,000" and " 5000 " both mean 5000. */
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[\s,]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const MAX_AMOUNT = 1_000_000_000_000;

export function amountRejection(value: number | null): string | null {
  if (value === null) return "Enter an amount.";
  if (value <= 0) return "The amount must be more than zero.";
  if (value > MAX_AMOUNT) return "That amount is too large.";
  return null;
}
