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
import { formatMoneyPlain } from "@/lib/money";

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
 * Anonymity — one rule for what a name reads as in public
 * ========================================================== */

/** What a hidden contributor is called. Overridable so it can be translated. */
export const ANONYMOUS_LABEL = "Anonymous";

export type PublicName = {
  /** What the world reads. Either the real name or the anonymous label. */
  name: string;
  /** Hidden, so a screen can style it and a share message can trust it. */
  anonymous: boolean;
};

/**
 * The public name of every person on a pot's roster.
 *
 * One function, called by the public query and by the share message, because
 * the two must never disagree: a leader who hides the names and then pastes a
 * message naming everybody has been told a lie by the settings screen.
 *
 * Two decisions worth stating.
 *
 * **The pot-level switch overrides the per-person flag, it does not merge with
 * it.** "Hide everyone" that left one person named because their own flag was
 * off would be the worst possible outcome — the one visible name in an
 * otherwise anonymous list is more exposed than they were before.
 *
 * **Hidden people are numbered, but only when there is more than one.** A
 * twenty-row list of the identical word "Anonymous" is a list nobody can read
 * and nobody can check: you cannot tell twenty people giving once from one
 * person giving twenty times, which is exactly the arithmetic this page exists
 * to make checkable. A single hidden person among named ones needs no number,
 * and giving them one would only invite the question of who 1 is.
 *
 * The numbers run in roster order, so "Anonymous 3" is the same person on the
 * page and in the message. They are not identifiers: removing somebody earlier
 * in the roster renumbers those after them, which is the honest trade for not
 * storing a public pseudonym that would then have to be kept for ever.
 */
export function publicNames(opts: {
  /** The roster, in a stable order — the caller sorts, so numbers do not jump. */
  roster: readonly { id: string; name: string; isAnonymous: boolean }[];
  /** The pot's "hide every name" setting. */
  hideNames: boolean;
  label?: string;
}): Map<string, PublicName> {
  const label = opts.label ?? ANONYMOUS_LABEL;
  const hiddenCount = opts.roster.filter(
    (c) => opts.hideNames || c.isAnonymous,
  ).length;
  const numbered = hiddenCount > 1;

  const out = new Map<string, PublicName>();
  let n = 0;
  for (const c of opts.roster) {
    if (!opts.hideNames && !c.isAnonymous) {
      out.set(c.id, { name: c.name, anonymous: false });
      continue;
    }
    n += 1;
    out.set(c.id, {
      name: numbered ? `${label} ${n}` : label,
      anonymous: true,
    });
  }
  return out;
}

/** Is every single name on this pot hidden? Decides whether "find my name" can work at all. */
export function everyNameHidden(opts: {
  hideNames: boolean;
  roster: readonly { isAnonymous: boolean }[];
}): boolean {
  if (opts.hideNames) return true;
  if (opts.roster.length === 0) return false;
  return opts.roster.every((c) => c.isAnonymous);
}

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

/* ------------------------------------------------------------
 * The full update — the collection itself, as a message
 * ---------------------------------------------------------- */

/**
 * How long the message may get.
 *
 * Not a WhatsApp limit — it accepts far more. It is a `wa.me` limit: the text
 * is percent-encoded into a URL, which roughly triples it, and a very long one
 * is silently truncated or refused by some in-app browsers. Trimming here is
 * deliberate and visible ("and 6 more"); trimming in the browser would cut the
 * message off mid-name with no sign that anything was lost.
 */
export const SHARE_MAX_CHARS = 2500;
const SHARE_MAX_ROWS = 15;
const SHARE_MIN_ROWS = 3;
const SHARE_MAX_OUTSTANDING = 10;
const SHARE_MAX_PAYOUTS = 6;

/** Every word the message is built from, so it can be sent in the church's language. */
export type ShareLabels = {
  raisedOf: string;
  raised: string;
  fromPeople: string;
  /**
   * The one-person wording, as its own label.
   *
   * Cheaper and clearer than plural rules inside this function: the caller
   * fetches both from the dictionary, which already knows how the language it
   * is in counts, and the composer only has to pick. "From 1 people" is the
   * kind of mistake a reader notices before they notice the total.
   */
  fromOnePerson: string;
  fromPeopleOf: string;
  whoHasGiven: string;
  stillToGive: string;
  whereItWent: string;
  leftInPot: string;
  howToPay: string;
  awaiting: string;
  andMore: string;
  closed: string;
  settled: string;
  goalReached: string;
  seeAndRecord: string;
  seeEverything: string;
  forPerson: string;
};

const SHARE_LABELS: ShareLabels = {
  raisedOf: "{raised} of {target}",
  raised: "{raised} so far",
  fromPeople: "From {count} people",
  fromOnePerson: "From 1 person",
  fromPeopleOf: "From {count} of {total} people",
  whoHasGiven: "Who has given",
  stillToGive: "Still to give",
  whereItWent: "Where the money went",
  leftInPot: "Left in the pot: {amount}",
  howToPay: "How to pay",
  awaiting: "awaiting",
  andMore: "…and {count} more on the page",
  closed: "Closed — no longer collecting.",
  settled: "Settled — every figure accounted for.",
  goalReached: "We have reached the goal.",
  seeAndRecord: "See everything, and record yours:",
  seeEverything: "See everything:",
  forPerson: "For {name}",
};

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/**
 * Ten blocks of progress.
 *
 * Block characters rather than a run of emoji, because they are a single width
 * in every font WhatsApp uses, so the bar is the same length on an iPhone, an
 * Android and WhatsApp Web. Emoji squares are wider than a space and wrap onto
 * a second line at phone width, which turns the neatest line in the message
 * into the untidiest.
 */
export function shareBar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "▓".repeat(filled) + "░".repeat(10 - filled);
}

export type ShareView = {
  title: string;
  churchName: string;
  groupName: string | null;
  purpose: string | null;
  honoureeName: string | null;
  status: ContributionStatus;
  currency: string;
  raised: number;
  target: number | null;
  paidOut: number;
  balance: number;
  /** People with at least one confirmed payment. */
  givers: number;
  /** People expected, where there is a roster. 0 when there is none. */
  people: number;
  goalReached: boolean;
  dueLabel: string | null;
  payInstructions: string | null;
  allowSelfReport: boolean;
  showPayouts: boolean;
  showOutstanding: boolean;
  /** Empty at `summary` visibility, exactly as the page has it. */
  ledger: readonly {
    name: string;
    amount: number | null;
    status: EntryStatus;
  }[];
  stillToGive: readonly { name: string; outstanding: number }[];
  payouts: readonly { label: string; amount: number; status: PayoutStatus }[];
  url: string;
};

/**
 * The whole collection as one WhatsApp message.
 *
 * The short version — a figure and a link — asks somebody to leave the chat to
 * find out anything at all. Most of them do not, and the ones who do are on a
 * phone with no data left. So this sends the answer instead of the question:
 * the figure, the bar, who has given, what is still owed, where the money went
 * and how to pay, set in the only three kinds of emphasis WhatsApp has.
 *
 * **It is built from the public view, never from the church's own screen.**
 * That is why this takes a `ShareView` shaped like the published page rather
 * than the full detail: whatever the link does not show, the message cannot
 * show either. A pot set to `summary` arrives here with an empty ledger, and
 * hidden names have already been replaced by `publicNames` upstream — so there
 * is no path by which a message names somebody the page protects.
 *
 * Trimming is visible. If the list is too long for a URL the message says how
 * many rows it left out rather than ending mid-sentence.
 */
export function shareText(view: ShareView, labels?: Partial<ShareLabels>): string {
  const L = { ...SHARE_LABELS, ...labels };
  // Plain, not the two-decimal form the tables use: a message is a sentence.
  const money = (n: number) => formatMoneyPlain(n, view.currency);

  function compose(maxRows: number): string {
    const out: string[] = [];

    // ----- The header: what this is, and whose -----
    out.push(`*${view.title}*`);
    const who = [view.churchName, view.groupName].filter(Boolean).join(" · ");
    if (who) out.push(who);
    if (view.honoureeName) out.push(fill(L.forPerson, { name: view.honoureeName }));
    if (view.purpose) out.push(`_${oneLine(view.purpose, 140)}_`);

    // ----- The figure, which is what the message is opened for -----
    out.push("");
    out.push(
      view.target
        ? `*${fill(L.raisedOf, {
            raised: money(view.raised),
            target: money(view.target),
          })}*`
        : `*${fill(L.raised, { raised: money(view.raised) })}*`,
    );
    const pct = progressPct(view.raised, view.target);
    // No target, no bar. A bar that is always full says nothing, and a bar
    // drawn against a goal nobody set would be inventing one.
    if (pct !== null) out.push(`${shareBar(pct)} ${pct}%`);

    const counts =
      view.people > 0
        ? fill(L.fromPeopleOf, { count: view.givers, total: view.people })
        : view.givers === 1
          ? L.fromOnePerson
          : fill(L.fromPeople, { count: view.givers });
    out.push([counts, view.dueLabel].filter(Boolean).join(" · "));

    if (view.goalReached) out.push(L.goalReached);
    if (view.status === "closed") out.push(L.closed);
    if (view.status === "settled") out.push(L.settled);

    // ----- Who has given. Already empty when the page does not show it. -----
    if (view.ledger.length > 0) {
      out.push("");
      out.push(`*${L.whoHasGiven}*`);
      for (const r of view.ledger.slice(0, maxRows)) {
        const amount = r.amount === null ? "" : ` — ${money(r.amount)}`;
        /*
         * Only confirmed money is in the figure at the top, so a claim nobody
         * has checked has to be marked here. Without the mark the lines do not
         * add up to the total, and a message whose arithmetic fails is worse
         * than no message — it is the argument it was sent to prevent.
         */
        const mark = r.status === "confirmed" ? "" : ` (${L.awaiting})`;
        out.push(`${oneLine(r.name, 40)}${amount}${mark}`);
      }
      const left = view.ledger.length - maxRows;
      if (left > 0) out.push(`_${fill(L.andMore, { count: left })}_`);
    }

    // ----- Still to give. Only when the church chose to publish it. -----
    if (view.showOutstanding && view.stillToGive.length > 0) {
      out.push("");
      out.push(`*${L.stillToGive}*`);
      for (const s of view.stillToGive.slice(0, SHARE_MAX_OUTSTANDING))
        out.push(`${oneLine(s.name, 40)} — ${money(s.outstanding)}`);
      const left = view.stillToGive.length - SHARE_MAX_OUTSTANDING;
      if (left > 0) out.push(`_${fill(L.andMore, { count: left })}_`);
    }

    // ----- Where it went. The question that splits departments. -----
    if (view.showPayouts) {
      const paid = view.payouts.filter((p) => p.status === "approved");
      if (paid.length > 0) {
        out.push("");
        out.push(`*${L.whereItWent}*`);
        for (const p of paid.slice(0, SHARE_MAX_PAYOUTS))
          out.push(`${oneLine(p.label, 40)} — ${money(p.amount)}`);
        const left = paid.length - SHARE_MAX_PAYOUTS;
        if (left > 0) out.push(`_${fill(L.andMore, { count: left })}_`);
        if (view.paidOut > 0)
          out.push(fill(L.leftInPot, { amount: money(view.balance) }));
      }
    }

    if (view.payInstructions) {
      out.push("");
      out.push(`*${L.howToPay}*`);
      out.push(oneLine(view.payInstructions, 200));
    }

    out.push("");
    out.push(view.allowSelfReport ? L.seeAndRecord : L.seeEverything);
    out.push(view.url);

    return out.join("\n");
  }

  /*
   * Compose, then shorten the one list that can grow without limit until the
   * whole thing fits a URL. Nothing else is trimmed: the totals, the deadline
   * and the pay instructions are the reason the message was sent.
   */
  let rows = SHARE_MAX_ROWS;
  let text = compose(rows);
  while (text.length > SHARE_MAX_CHARS && rows > SHARE_MIN_ROWS) {
    rows -= 1;
    text = compose(rows);
  }
  return text;
}

/** Newlines flattened, length capped — a textarea field has to become one line here. */
function oneLine(input: string, max: number): string {
  const flat = input.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** The public path for a pot. One place, so a link in an email cannot drift. */
export function contributionPath(slug: string): string {
  return `/p/${slug}`;
}

/**
 * The full, absolute link — the only thing that may ever be shared.
 *
 * This exists because the path alone once got out. The public page derived its
 * URL from `window.location.origin`, which is undefined during the server
 * render, so the WhatsApp button was built with a bare "/p/slug" and baked into
 * the HTML that way. Tap it before React hydrates and you send half a link: the
 * recipient sees "record yours: /p/choir-levy-ab12c" and has nowhere to go.
 *
 * The base therefore comes from the server, which always knows it, and never
 * from the browser. Anything that shares a link goes through here.
 */
export function contributionUrl(slug: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${contributionPath(slug)}`;
}

/** Is this safe to put in a message? A bare path is not. */
export function isShareableUrl(url: string): boolean {
  return /^https?:\/\/[^/]+\/.+/.test(url);
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
