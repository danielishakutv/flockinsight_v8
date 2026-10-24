import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { partner, partnerDigest, partnerEarning, platformSetting, user } from "@/db/schema";
import { emailLayout, sendEmailWithId } from "@/lib/mailer";
import { escapeHtml } from "@/lib/html-escape";
import { siteUrl } from "@/lib/site";
import { getPlanPrices } from "@/lib/pricing";
import { PLAN_BY_ID } from "@/lib/plans";
import { partnerShareLink } from "@/lib/partner-link";
import {
  getPartnerRates,
  hasOpenPayout,
  livePayingChurches,
  partnerChurches,
  partnerWallet,
} from "@/lib/partners";
import { nextTier, tierFor, type PartnerRates } from "@/lib/partners-shared";
import {
  composeDigest,
  digestSlotFor,
  digestSlotIndex,
  type DigestEmail,
  type DigestFacts,
} from "@/lib/partner-digest-shared";
import { deliverStatusEmail } from "@/lib/partner-notices";

/**
 * The partner-emails job: status emails that have not been delivered yet, and
 * the twice-weekly progress email. See partner-digest-shared.ts for the words
 * and the schedule; this file gathers the figures and does the sending.
 */

const ENABLED_KEY = "partner_digest_enabled";
/** Tries per Partner per send day before it is left for the next one. */
const MAX_ATTEMPTS = 3;
/** How long an undelivered status email keeps being retried. */
const STATUS_RETRY_DAYS = 3;
/**
 * Leave a just-made change to the request that made it. The action sends the
 * email itself; retrying inside these minutes would race it and send twice.
 */
const STATUS_RETRY_AFTER_MS = 5 * 60_000;

const SECRET =
  process.env.BETTER_AUTH_SECRET || process.env.CRON_SECRET || "flockinsight-dev";

/* ============================================================
 * The switch
 * ========================================================== */

/** On unless superadmin turned it off. */
export async function partnerDigestEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, ENABLED_KEY))
    .limit(1);
  return row?.value !== "false";
}

export async function setPartnerDigestEnabled(on: boolean): Promise<void> {
  const value = on ? "true" : "false";
  await db
    .insert(platformSetting)
    .values({ key: ENABLED_KEY, value })
    .onConflictDoUpdate({ target: platformSetting.key, set: { value } });
}

/* ============================================================
 * Unsubscribing
 * ========================================================== */

/**
 * The signature on an unsubscribe link. Its own purpose string, so a token
 * from any other signed link in the platform can never be replayed here.
 */
export function digestUnsubToken(partnerId: string): string {
  return createHmac("sha256", SECRET)
    .update(`partner-digest-unsubscribe:${partnerId}`)
    .digest("base64url");
}

export function verifyDigestUnsub(partnerId: string, token: string): boolean {
  const expected = Buffer.from(digestUnsubToken(partnerId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function digestUnsubUrl(partnerId: string): string {
  return `${siteUrl()}/api/partner/unsubscribe?p=${encodeURIComponent(partnerId)}&t=${digestUnsubToken(partnerId)}`;
}

/** Stop or restart one Partner's progress emails. Returns whether it changed. */
export async function setDigestOptOut(partnerId: string, optOut: boolean): Promise<boolean> {
  const changed = await db
    .update(partner)
    .set({ digestOptOutAt: optOut ? new Date() : null })
    .where(
      and(
        eq(partner.id, partnerId),
        optOut ? isNull(partner.digestOptOutAt) : sql`${partner.digestOptOutAt} is not null`,
      ),
    )
    .returning({ id: partner.id });
  return changed.length > 0;
}

/* ============================================================
 * The figures
 * ========================================================== */

type PartnerForDigest = {
  id: string;
  code: string;
  displayName: string;
  status: "pending" | "active" | "paused" | "suspended";
  tierOverride: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  email: string;
};

const partnerColumns = {
  id: partner.id,
  code: partner.code,
  displayName: partner.displayName,
  status: partner.status,
  tierOverride: partner.tierOverride,
  bankName: partner.bankName,
  bankAccountNumber: partner.bankAccountNumber,
  bankAccountName: partner.bankAccountName,
  emailVerifiedAt: partner.emailVerifiedAt,
  phoneVerifiedAt: partner.phoneVerifiedAt,
  email: user.email,
};

/** When this Partner was last sent a progress email, or null. */
async function lastSentAt(partnerId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: partnerDigest.sentAt })
    .from(partnerDigest)
    .where(and(eq(partnerDigest.partnerId, partnerId), eq(partnerDigest.status, "sent")))
    .orderBy(desc(partnerDigest.sentAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * Everything one email needs, from the same functions the Partner's own
 * dashboard reads — so the email can never disagree with the page it links to.
 */
export async function digestFacts(
  p: PartnerForDigest,
  rates: PartnerRates,
  examplePlan: DigestFacts["examplePlan"],
  now: Date = new Date(),
): Promise<DigestFacts> {
  // "Since your last update", or the last week for a first email.
  const since = (await lastSentAt(p.id)) ?? new Date(now.getTime() - 7 * 86_400_000);

  const [churches, live, wallet, open, [earned]] = await Promise.all([
    partnerChurches(p.id),
    livePayingChurches(p.id, rates),
    partnerWallet(p.id),
    hasOpenPayout(p.id),
    db
      .select({ total: sql<string>`coalesce(sum(${partnerEarning.amount}), 0)` })
      .from(partnerEarning)
      .where(
        and(
          eq(partnerEarning.partnerId, p.id),
          gt(partnerEarning.createdAt, since),
          ne(partnerEarning.status, "cancelled"),
        ),
      ),
  ]);

  const tier = tierFor(rates, live, p.tierOverride);
  const ahead = nextTier(rates, live);
  const latestSignup = churches.reduce<number | null>((max, c) => {
    const t = Date.parse(c.signedUpAt);
    return max === null || t > max ? t : max;
  }, null);

  return {
    displayName: p.displayName,
    status: p.status === "pending" ? "pending" : "active",
    code: p.code,
    shareLink: partnerShareLink(siteUrl(), p.code),
    churchesSigned: churches.length,
    churchesEverPaid: churches.filter((c) => c.payments > 0).length,
    notYetPaying: churches.filter((c) => c.payments === 0).map((c) => c.name),
    liveChurches: live,
    newSinceLast: churches.filter((c) => Date.parse(c.signedUpAt) > since.getTime()).length,
    earnedSinceLast: Math.max(0, Number(earned?.total ?? 0)),
    available: wallet.available,
    lifetime: wallet.lifetime,
    daysSinceLastSignup:
      latestSignup === null ? null : Math.floor((now.getTime() - latestSignup) / 86_400_000),
    tier: { name: tier.name, firstBps: tier.firstBps, secondBps: tier.secondBps },
    next: ahead
      ? { name: ahead.tier.name, needed: ahead.needed, firstBps: ahead.tier.firstBps }
      : null,
    minPayout: rates.minPayout,
    hasBank: !!(p.bankName && p.bankAccountNumber && p.bankAccountName),
    emailVerified: !!p.emailVerifiedAt,
    phoneVerified: !!p.phoneVerifiedAt,
    openRequest: open,
    examplePlan,
  };
}

/** Growth is the plan most churches choose; its live price, not the coded one. */
async function examplePlan(): Promise<DigestFacts["examplePlan"]> {
  const prices = await getPlanPrices();
  const monthly = prices.growth;
  return monthly ? { name: PLAN_BY_ID.growth.name, monthly } : null;
}

/* ============================================================
 * Rendering and sending
 * ========================================================== */

export function renderDigest(email: DigestEmail, unsubUrl: string): { html: string; text: string } {
  const body =
    email.paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join("") +
    `<div style="margin:16px 0;padding:12px 14px;border-radius:10px;background:#f3f0ff;color:#2a2340">` +
    `<strong>This week's tip:</strong> ${escapeHtml(email.tip)}</div>`;
  // After the button, in place of the layout's "you can ignore this".
  const footer =
    `You get these updates on Mondays and Thursdays because you are a FlockInsight Partner. ` +
    `<a href="${escapeHtml(unsubUrl)}" style="color:#8a86a0">Stop these updates</a> — emails about your account and payments will still come.`;
  const html = emailLayout(
    escapeHtml(email.heading),
    body,
    { label: email.cta.label, url: `${siteUrl()}${email.cta.path}` },
    { footer },
  );
  const text =
    `${email.heading}\n\n${email.paragraphs.join("\n\n")}\n\nThis week's tip: ${email.tip}\n\n` +
    `${email.cta.label}: ${siteUrl()}${email.cta.path}\n\nStop these updates: ${unsubUrl}`;
  return { html, text };
}

export type DigestOutcome =
  | { outcome: "sent"; segment: string; subject: string }
  | { outcome: "failed"; segment: string; error: string }
  | { outcome: "skipped"; reason: string };

/**
 * Send one Partner their progress email for one slot, at most once.
 *
 * The claim comes first: a row inserted with ON CONFLICT DO NOTHING, so a
 * second run for the same slot finds the row and stops. A FAILED row may be
 * claimed again — by a conditional update that only one run can win — up to
 * MAX_ATTEMPTS, so a provider outage at 09:00 is made up at 10:00.
 */
export async function sendPartnerDigest(opts: {
  partnerId: string;
  slot: string;
  slotIndex: number;
  rates?: PartnerRates;
  plan?: DigestFacts["examplePlan"];
  now?: Date;
}): Promise<DigestOutcome> {
  const now = opts.now ?? new Date();
  const [p] = await db
    .select(partnerColumns)
    .from(partner)
    .innerJoin(user, eq(user.id, partner.userId))
    .where(eq(partner.id, opts.partnerId))
    .limit(1);
  if (!p) return { outcome: "skipped", reason: "no such Partner" };
  if (!p.email) return { outcome: "skipped", reason: "no email address" };

  const rates = opts.rates ?? (await getPartnerRates());
  const plan = opts.plan === undefined ? await examplePlan() : opts.plan;
  const facts = await digestFacts(p, rates, plan, now);
  const email = composeDigest(facts, opts.slotIndex);

  // Claim: a new row, or a failed one with tries left.
  const [fresh] = await db
    .insert(partnerDigest)
    .values({
      partnerId: p.id,
      slot: opts.slot,
      segment: email.segment,
      status: "claimed",
      attempts: 1,
    })
    .onConflictDoNothing({ target: [partnerDigest.partnerId, partnerDigest.slot] })
    .returning({ id: partnerDigest.id });
  let claimId = fresh?.id;
  if (!claimId) {
    const [again] = await db
      .update(partnerDigest)
      .set({
        status: "claimed",
        segment: email.segment,
        attempts: sql`${partnerDigest.attempts} + 1`,
        error: null,
      })
      .where(
        and(
          eq(partnerDigest.partnerId, p.id),
          eq(partnerDigest.slot, opts.slot),
          eq(partnerDigest.status, "failed"),
          lt(partnerDigest.attempts, MAX_ATTEMPTS),
        ),
      )
      .returning({ id: partnerDigest.id });
    if (!again) return { outcome: "skipped", reason: "already sent or in progress for this day" };
    claimId = again.id;
  }

  const unsub = digestUnsubUrl(p.id);
  const { html, text } = renderDigest(email, unsub);
  let result: { ok: boolean; error?: string };
  try {
    result = await sendEmailWithId({
      to: p.email,
      subject: email.subject,
      html,
      text,
      bulk: true,
      // RFC 8058: the mail app's own Unsubscribe button, with no page at all.
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const meta = {
    churchesSigned: facts.churchesSigned,
    churchesEverPaid: facts.churchesEverPaid,
    liveChurches: facts.liveChurches,
    newSinceLast: facts.newSinceLast,
    earnedSinceLast: facts.earnedSinceLast,
    available: facts.available,
    tier: facts.tier.name,
  };
  await db
    .update(partnerDigest)
    .set({
      status: result.ok ? "sent" : "failed",
      subject: email.subject,
      error: result.ok ? null : (result.error ?? "the mail provider did not accept it").slice(0, 500),
      sentAt: result.ok ? new Date() : null,
      meta,
    })
    .where(eq(partnerDigest.id, claimId));

  if (!result.ok) {
    console.warn(`[partner-digest] ${p.code} ${opts.slot}: not sent — ${result.error ?? "not accepted"}`);
    return { outcome: "failed", segment: email.segment, error: result.error ?? "not accepted" };
  }
  return { outcome: "sent", segment: email.segment, subject: email.subject };
}

/* ============================================================
 * The job
 * ========================================================== */

export type DigestRunSummary = {
  slot: string | null;
  skipped?: string;
  eligible: number;
  sent: number;
  failed: number;
  alreadyDone: number;
  bySegment: Record<string, number>;
  errors: string[];
};

/**
 * Who gets a progress email: active and pending Partners who have not opted
 * out and joined more than a day ago. Paused and suspended Partners get the
 * email about their status, not encouragement.
 */
export async function runPartnerDigests(now: Date = new Date()): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = {
    slot: digestSlotFor(now),
    eligible: 0,
    sent: 0,
    failed: 0,
    alreadyDone: 0,
    bySegment: {},
    errors: [],
  };
  if (!(await partnerDigestEnabled())) return { ...summary, skipped: "turned off in superadmin" };
  if (!summary.slot) return { ...summary, skipped: "not a send window" };
  const slot = summary.slot;

  const eligible = await db
    .select({ id: partner.id })
    .from(partner)
    .innerJoin(user, eq(user.id, partner.userId))
    .where(
      and(
        inArray(partner.status, ["active", "pending"]),
        isNull(partner.digestOptOutAt),
        lt(partner.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  summary.eligible = eligible.length;

  // Done already, or out of tries: skipped without gathering a single figure.
  const settled = new Set(
    (
      await db
        .select({ partnerId: partnerDigest.partnerId })
        .from(partnerDigest)
        .where(
          and(
            eq(partnerDigest.slot, slot),
            or(
              inArray(partnerDigest.status, ["sent", "claimed"]),
              sql`${partnerDigest.attempts} >= ${MAX_ATTEMPTS}`,
            ),
          ),
        )
    ).map((r) => r.partnerId),
  );

  const rates = await getPartnerRates();
  const plan = await examplePlan();
  const slotIndex = digestSlotIndex(slot);

  for (const { id } of eligible) {
    if (settled.has(id)) {
      summary.alreadyDone++;
      continue;
    }
    try {
      const res = await sendPartnerDigest({ partnerId: id, slot, slotIndex, rates, plan, now });
      if (res.outcome === "sent") {
        summary.sent++;
        summary.bySegment[res.segment] = (summary.bySegment[res.segment] ?? 0) + 1;
      } else if (res.outcome === "failed") {
        summary.failed++;
        if (summary.errors.length < 5) summary.errors.push(res.error);
      } else {
        summary.alreadyDone++;
      }
    } catch (e) {
      // One Partner's bad data must not stop everybody else's email.
      summary.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      if (summary.errors.length < 5) summary.errors.push(msg);
      console.error(`[partner-digest] partner ${id} ${slot} threw`, e);
    }
  }
  return summary;
}

/**
 * Retry every status email that has not been delivered yet.
 *
 * "Not delivered" is declared, not guessed: `statusNotifiedAt` behind
 * `statusChangedAt`. Tried for three days; a change still untold after one
 * day is also a platform alert (lib/platform-alerts.ts).
 */
export async function retryStatusEmails(
  now: Date = new Date(),
): Promise<{ owed: number; delivered: number; failed: number }> {
  const owed = await db
    .select({ id: partner.id })
    .from(partner)
    .where(
      and(
        gt(partner.statusChangedAt, new Date(now.getTime() - STATUS_RETRY_DAYS * 86_400_000)),
        lt(partner.statusChangedAt, new Date(now.getTime() - STATUS_RETRY_AFTER_MS)),
        or(
          isNull(partner.statusNotifiedAt),
          sql`${partner.statusNotifiedAt} < ${partner.statusChangedAt}`,
        ),
      ),
    );

  let delivered = 0;
  let failed = 0;
  for (const { id } of owed) {
    try {
      const res = await deliverStatusEmail(id);
      if (res === "sent") delivered++;
      else if (res === "failed") failed++;
    } catch (e) {
      failed++;
      console.error(`[partner-digest] status email retry for ${id} threw`, e);
    }
  }
  return { owed: owed.length, delivered, failed };
}

/** The last few progress emails one Partner was sent, for their admin page. */
export async function recentDigests(partnerId: string, limit = 8) {
  return db
    .select({
      id: partnerDigest.id,
      slot: partnerDigest.slot,
      segment: partnerDigest.segment,
      status: partnerDigest.status,
      subject: partnerDigest.subject,
      error: partnerDigest.error,
      attempts: partnerDigest.attempts,
      createdAt: partnerDigest.createdAt,
      sentAt: partnerDigest.sentAt,
    })
    .from(partnerDigest)
    .where(eq(partnerDigest.partnerId, partnerId))
    .orderBy(desc(partnerDigest.createdAt))
    .limit(limit);
}

/** How the most recent send day went, for the Partners page. */
export async function latestDigestDay(): Promise<{
  slot: string;
  sent: number;
  failed: number;
  bySegment: Record<string, number>;
} | null> {
  const [latest] = await db
    .select({ slot: partnerDigest.slot })
    .from(partnerDigest)
    .where(sql`${partnerDigest.slot} not like 'manual:%'`)
    .orderBy(desc(partnerDigest.slot))
    .limit(1);
  if (!latest) return null;
  const rows = await db
    .select({
      segment: partnerDigest.segment,
      status: partnerDigest.status,
      n: sql<number>`count(*)::int`,
    })
    .from(partnerDigest)
    .where(eq(partnerDigest.slot, latest.slot))
    .groupBy(partnerDigest.segment, partnerDigest.status);
  const out = { slot: latest.slot, sent: 0, failed: 0, bySegment: {} as Record<string, number> };
  for (const r of rows) {
    if (r.status === "sent") {
      out.sent += Number(r.n);
      out.bySegment[r.segment] = (out.bySegment[r.segment] ?? 0) + Number(r.n);
    } else if (r.status === "failed") out.failed += Number(r.n);
  }
  return out;
}
