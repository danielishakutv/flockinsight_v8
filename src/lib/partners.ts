import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  partner,
  partnerEarning,
  partnerPayout,
  partnerReferral,
  payment,
  platformSetting,
} from "@/db/schema";
import {
  DEFAULT_PARTNER_RATES,
  earningFor,
  generatePartnerCode,
  normalisePartnerCode,
  normaliseRates,
  tierFor,
  walletTotals,
  type PartnerRates,
  type PartnerTier,
} from "@/lib/partners-shared";

/**
 * Partners: the field agents who bring churches, and what they are owed.
 *
 * Two rules shape this file, and both are structural rather than remembered.
 *
 * **A Partner sees numbers, never members.** Nothing here selects a member, a
 * phone number or an address. The most a Partner learns about one of their
 * churches is its name, plan, status and whether it is recording anything —
 * which is what they need to help, and the line past which helping becomes
 * surveillance of somebody else's congregation.
 *
 * **Money is a ledger.** Every earning is a row carrying the payment it came
 * from and the rate used, and a balance is the sum of rows. A stored balance is
 * one bad update away from being wrong with nothing to reconcile against.
 */

const RATES_KEY = "partner_rates";

/* ============================================================
 * Rates
 * ========================================================== */

export async function getPartnerRates(): Promise<PartnerRates> {
  const [row] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, RATES_KEY))
    .limit(1);
  if (!row?.value) return DEFAULT_PARTNER_RATES;
  try {
    return normaliseRates(JSON.parse(row.value));
  } catch {
    // A hand-edited row must not take the whole module down; the shipped
    // ladder is a safe answer and the superadmin page will show it.
    return DEFAULT_PARTNER_RATES;
  }
}

export async function setPartnerRates(next: PartnerRates): Promise<void> {
  const clean = normaliseRates(next);
  await db
    .insert(platformSetting)
    .values({ key: RATES_KEY, value: JSON.stringify(clean) })
    .onConflictDoUpdate({
      target: platformSetting.key,
      set: { value: JSON.stringify(clean) },
    });
}

/* ============================================================
 * Who is a Partner
 * ========================================================== */

export async function partnerForUser(userId: string) {
  const [row] = await db
    .select()
    .from(partner)
    .where(eq(partner.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function partnerByCode(code: string) {
  const clean = normalisePartnerCode(code);
  if (!clean) return null;
  const [row] = await db
    .select({ id: partner.id, status: partner.status, code: partner.code })
    .from(partner)
    .where(eq(partner.code, clean))
    .limit(1);
  return row ?? null;
}

/**
 * Make somebody a Partner, with a code nobody else has.
 *
 * The code is read out loud down a phone line, so it is generated from an
 * alphabet with no lookalikes and retried on the (rare) collision rather than
 * made longer. Eight attempts and then a long fallback, which is the same
 * shape the meeting codes use.
 */
export async function createPartner(opts: {
  userId: string;
  displayName: string;
  phone?: string | null;
}): Promise<{ ok: true; id: string; code: string } | { ok: false; error: string }> {
  const existing = await partnerForUser(opts.userId);
  if (existing) {
    return { ok: false, error: "This account is already a Partner." };
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generatePartnerCode();
    const taken = await partnerByCode(code);
    if (taken) continue;
    const [row] = await db
      .insert(partner)
      .values({
        userId: opts.userId,
        code,
        displayName: opts.displayName.trim().slice(0, 120) || "Partner",
        phone: opts.phone?.trim() || null,
        status: "pending",
      })
      .returning({ id: partner.id, code: partner.code });
    return { ok: true, id: row.id, code: row.code };
  }
  return { ok: false, error: "We couldn't allocate a referral code. Try again." };
}

/* ============================================================
 * Attribution
 * ========================================================== */

/**
 * Record which Partner brought this church. Once, and never again.
 *
 * `onConflictDoNothing` on the church is the whole guarantee: attribution is
 * decided when a church signs up and is never re-pointed, so two agents
 * claiming the same church is a conversation for people rather than something
 * the ledger can express. A suspended Partner still gets the attribution —
 * whether they get PAID is a separate question, answered at payment time.
 */
export async function attributeChurch(opts: {
  churchId: string;
  code: string;
  source?: "link" | "portal";
}): Promise<boolean> {
  const p = await partnerByCode(opts.code);
  if (!p) return false;
  const inserted = await db
    .insert(partnerReferral)
    .values({
      partnerId: p.id,
      churchId: opts.churchId,
      source: opts.source ?? "link",
    })
    .onConflictDoNothing({ target: partnerReferral.churchId })
    .returning({ id: partnerReferral.id });
  return inserted.length > 0;
}

/* ============================================================
 * Earning
 * ========================================================== */

/**
 * Pay the Partner for a church's payment that has just succeeded.
 *
 * Called from the gateway callback, beside the church-to-church referral
 * reward, and it has to obey the same two rules that one does: it must be
 * **idempotent**, because Paystack replays callbacks, and it must **never
 * throw**, because a commission failing is not a reason to fail a payment the
 * church has already made.
 *
 * Idempotence is a unique index on (payment, kind) rather than a check-then-
 * insert, so two replayed callbacks racing each other cannot both win.
 *
 * The payment NUMBER is counted from the church's successful payments, which is
 * what decides whether this is the first commission, the second, or the trail.
 * Counting rather than storing a flag means a refunded or corrected payment
 * changes the answer, instead of leaving a flag that disagrees with the money.
 */
export async function awardPartnerCommission(
  paymentId: string,
): Promise<{ awarded: boolean; reason?: string }> {
  try {
    const [pay] = await db
      .select({
        id: payment.id,
        churchId: payment.churchId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt,
      })
      .from(payment)
      .where(eq(payment.id, paymentId))
      .limit(1);
    if (!pay) return { awarded: false, reason: "no such payment" };
    if (pay.status !== "success") return { awarded: false, reason: "not successful" };

    const [ref] = await db
      .select({ partnerId: partnerReferral.partnerId })
      .from(partnerReferral)
      .where(eq(partnerReferral.churchId, pay.churchId))
      .limit(1);
    if (!ref) return { awarded: false, reason: "not a referred church" };

    const [p] = await db
      .select({
        id: partner.id,
        status: partner.status,
        tierOverride: partner.tierOverride,
      })
      .from(partner)
      .where(eq(partner.id, ref.partnerId))
      .limit(1);
    if (!p) return { awarded: false, reason: "partner is gone" };
    if (p.status === "suspended") {
      return { awarded: false, reason: "partner is suspended" };
    }

    // Which successful payment of this church's this is, counting from one.
    const [counted] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(payment)
      .where(
        and(
          eq(payment.churchId, pay.churchId),
          eq(payment.status, "success"),
          pay.paidAt
            ? sql`${payment.paidAt} <= ${pay.paidAt}`
            : sql`true`,
        ),
      );
    const paymentNumber = Math.max(1, Number(counted?.c ?? 1));

    const rates = await getPartnerRates();
    const tier = tierFor(rates, await livePayingChurches(p.id, rates), p.tierOverride);
    const earned = earningFor({
      rates,
      tier,
      amount: Number(pay.amount),
      paymentNumber,
    });
    if (!earned) return { awarded: false, reason: "nothing earned at this point" };

    /*
     * Available straight away, because the holding-back is already expressed
     * by WHICH payment earns what: the second commission is not released on a
     * timer, it is simply not earned until the second payment clears. A
     * "pending" status is left in the schema for a future rule that needs it
     * (a refund window, say) rather than used to fake one now.
     */
    const inserted = await db
      .insert(partnerEarning)
      .values({
        partnerId: p.id,
        churchId: pay.churchId,
        paymentId: pay.id,
        kind: earned.kind,
        amount: earned.amount,
        currency: pay.currency,
        rateBps: earned.rateBps,
        status: "available",
      })
      .onConflictDoNothing({
        target: [partnerEarning.paymentId, partnerEarning.kind],
      })
      .returning({ id: partnerEarning.id });

    return { awarded: inserted.length > 0, reason: inserted.length ? undefined : "already awarded" };
  } catch (e) {
    // Logged and swallowed, deliberately: the church has paid, and a
    // commission that failed to record must not turn that into a failed
    // payment. The ledger can be reconciled; a lost payment cannot.
    console.error("[partners] could not award a commission", e);
    return { awarded: false, reason: "error" };
  }
}

/**
 * How many of a Partner's churches are live AND paying in the rolling window.
 *
 * The tier qualifies on this rather than on sign-ups, which is the whole
 * difference between rewarding work and paying for churn.
 */
export async function livePayingChurches(
  partnerId: string,
  rates: PartnerRates,
): Promise<number> {
  const since = new Date(Date.now() - rates.tierWindowDays * 86_400_000);
  const [row] = await db
    .select({ c: sql<number>`count(distinct ${payment.churchId})::int` })
    .from(payment)
    .innerJoin(partnerReferral, eq(partnerReferral.churchId, payment.churchId))
    .innerJoin(church, eq(church.id, payment.churchId))
    .where(
      and(
        eq(partnerReferral.partnerId, partnerId),
        eq(payment.status, "success"),
        gte(payment.paidAt, since),
        eq(church.status, "active"),
      ),
    );
  return Number(row?.c ?? 0);
}

/* ============================================================
 * What a Partner sees
 * ========================================================== */

export type PartnerChurch = {
  churchId: string;
  name: string;
  plan: string;
  status: string;
  city: string | null;
  country: string;
  signedUpAt: string;
  payments: number;
  lastPaidAt: string | null;
  earned: number;
};

/**
 * The churches a Partner signed, and only what helps them help.
 *
 * Name, plan, status, where it is, whether it has paid and what they earned.
 * Deliberately NOT: members, attendance, giving figures, or anything a church
 * would consider its own. A Partner is not staff of that church.
 */
export async function partnerChurches(partnerId: string): Promise<PartnerChurch[]> {
  const rows = await db
    .select({
      churchId: church.id,
      name: church.name,
      plan: church.plan,
      status: church.status,
      city: church.city,
      country: church.country,
      signedUpAt: partnerReferral.createdAt,
    })
    .from(partnerReferral)
    .innerJoin(church, eq(church.id, partnerReferral.churchId))
    .where(eq(partnerReferral.partnerId, partnerId))
    .orderBy(desc(partnerReferral.createdAt));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.churchId);

  const [pays, earnings] = await Promise.all([
    db
      .select({
        churchId: payment.churchId,
        c: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${payment.paidAt})`,
      })
      .from(payment)
      .where(and(inArray(payment.churchId, ids), eq(payment.status, "success")))
      .groupBy(payment.churchId),
    db
      .select({
        churchId: partnerEarning.churchId,
        total: sql<string>`coalesce(sum(${partnerEarning.amount}), 0)`,
      })
      .from(partnerEarning)
      .where(
        and(
          eq(partnerEarning.partnerId, partnerId),
          inArray(partnerEarning.churchId, ids),
        ),
      )
      .groupBy(partnerEarning.churchId),
  ]);

  const payByChurch = new Map(pays.map((p) => [p.churchId, p]));
  const earnByChurch = new Map(
    earnings.map((e) => [e.churchId ?? "", Number(e.total)]),
  );

  return rows.map((r) => {
    const p = payByChurch.get(r.churchId);
    return {
      ...r,
      signedUpAt: r.signedUpAt.toISOString(),
      payments: Number(p?.c ?? 0),
      lastPaidAt: p?.last ? new Date(p.last).toISOString() : null,
      earned: earnByChurch.get(r.churchId) ?? 0,
    };
  });
}

export async function partnerWallet(partnerId: string) {
  const rows = await db
    .select({
      amount: partnerEarning.amount,
      status: partnerEarning.status,
      payoutId: partnerEarning.payoutId,
    })
    .from(partnerEarning)
    .where(eq(partnerEarning.partnerId, partnerId));
  return walletTotals(
    rows.map((r) => ({
      amount: Number(r.amount),
      status: r.status,
      payoutId: r.payoutId,
    })),
  );
}

export async function partnerEarnings(partnerId: string, limit = 200) {
  return db
    .select({
      id: partnerEarning.id,
      kind: partnerEarning.kind,
      amount: partnerEarning.amount,
      currency: partnerEarning.currency,
      rateBps: partnerEarning.rateBps,
      status: partnerEarning.status,
      // So the list can say "in a request" rather than repeating "available"
      // for money the Partner has already asked for.
      payoutId: partnerEarning.payoutId,
      createdAt: partnerEarning.createdAt,
      churchName: church.name,
    })
    .from(partnerEarning)
    .leftJoin(church, eq(church.id, partnerEarning.churchId))
    .where(eq(partnerEarning.partnerId, partnerId))
    .orderBy(desc(partnerEarning.createdAt))
    .limit(limit);
}

export async function partnerPayouts(partnerId: string, limit = 50) {
  return db
    .select()
    .from(partnerPayout)
    .where(eq(partnerPayout.partnerId, partnerId))
    .orderBy(desc(partnerPayout.requestedAt))
    .limit(limit);
}

export async function hasOpenPayout(partnerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: partnerPayout.id })
    .from(partnerPayout)
    .where(
      and(
        eq(partnerPayout.partnerId, partnerId),
        inArray(partnerPayout.status, ["requested", "approved"]),
      ),
    )
    .limit(1);
  return !!row;
}

/* ============================================================
 * Withdrawing
 * ========================================================== */

/**
 * Turn available earnings into a payout request.
 *
 * Oldest first, so a Partner's ledger drains in the order it filled. Nothing
 * here sends money: a human approves and marks it paid in superadmin against a
 * transfer they actually made.
 *
 * **One transaction is not enough to stop a double withdrawal, and an earlier
 * version of this comment claimed it was.** Postgres runs READ COMMITTED, so
 * two requests arriving together each select the same unclaimed earnings —
 * neither can see the other's uncommitted write. Both insert a payout; the
 * second UPDATE waits for the first to commit and then overwrites `payout_id`.
 * The result is two payout rows for one balance, with the ledger pointing at
 * only the later one, and a human paying both.
 *
 * So the claim is held three ways, and each one alone would do it:
 *
 * - `for("update")` locks the earning rows. The second transaction blocks,
 *   then re-checks its own WHERE against the committed row — `payout_id` is
 *   now set, the rows no longer qualify, and it correctly finds nothing.
 * - the UPDATE repeats `isNull(payoutId)` and counts what came back. If a row
 *   was claimed between the select and the update, the numbers disagree and
 *   the whole transaction is thrown away rather than half-applied.
 * - `partner_payout_one_open_idx` lets the database refuse a second open
 *   request outright, which is also why a unique violation here is an
 *   expected answer and not a crash.
 */
export async function requestPayout(opts: {
  partnerId: string;
  amount: number;
  bank: { name: string | null; accountNumber: string | null; accountName: string | null };
  currency: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    return await db.transaction(async (tx) => {
      // Re-checked inside the transaction, not just in the action: the
      // courtesy check out there ran before this one took any lock.
      const [open] = await tx
        .select({ id: partnerPayout.id })
        .from(partnerPayout)
        .where(
          and(
            eq(partnerPayout.partnerId, opts.partnerId),
            inArray(partnerPayout.status, ["requested", "approved"]),
          ),
        )
        .limit(1);
      if (open) {
        return {
          ok: false as const,
          error: "You already have a withdrawal waiting. We'll settle that one first.",
        };
      }

      const rows = await tx
        .select({ id: partnerEarning.id, amount: partnerEarning.amount })
        .from(partnerEarning)
        .where(
          and(
            eq(partnerEarning.partnerId, opts.partnerId),
            eq(partnerEarning.status, "available"),
            isNull(partnerEarning.payoutId),
          ),
        )
        .orderBy(asc(partnerEarning.createdAt))
        .for("update");

      const available = rows.reduce((sum, r) => sum + Number(r.amount), 0);
      if (opts.amount > available + 0.001) {
        return { ok: false as const, error: "That is more than your available balance." };
      }

      // Take whole earnings until the request is covered. Splitting a row would
      // make the ledger stop explaining itself for the sake of a few kobo.
      const taken: string[] = [];
      let running = 0;
      for (const r of rows) {
        if (running >= opts.amount - 0.001) break;
        taken.push(r.id);
        running += Number(r.amount);
      }
      if (taken.length === 0) {
        return { ok: false as const, error: "There is nothing available to withdraw." };
      }

      const [payout] = await tx
        .insert(partnerPayout)
        .values({
          partnerId: opts.partnerId,
          // What is actually being paid is the earnings taken, not the number
          // typed — so the payout and the ledger can never disagree.
          amount: Math.round(running * 100) / 100,
          currency: opts.currency,
          status: "requested",
          bankName: opts.bank.name,
          bankAccountNumber: opts.bank.accountNumber,
          bankAccountName: opts.bank.accountName,
        })
        .returning({ id: partnerPayout.id });

      const claimed = await tx
        .update(partnerEarning)
        .set({ payoutId: payout.id })
        .where(
          and(
            inArray(partnerEarning.id, taken),
            // Repeated, so the UPDATE itself refuses a row somebody else took.
            isNull(partnerEarning.payoutId),
          ),
        )
        .returning({ id: partnerEarning.id });

      if (claimed.length !== taken.length) {
        // Throwing is the point: it takes the payout row back out with it.
        // Half a claim would be a request for money the ledger never gave up.
        throw new PayoutRaced(
          `claimed ${claimed.length} of ${taken.length} earnings for partner ${opts.partnerId}`,
        );
      }

      return { ok: true as const, id: payout.id };
    });
  } catch (err) {
    if (err instanceof PayoutRaced) {
      console.warn(`[partners] payout rolled back: ${err.message}`);
      return {
        ok: false as const,
        error: "That request came in twice. Please check your wallet and try again.",
      };
    }
    // The one-open-request index firing is an answer, not a fault.
    if (isUniqueViolation(err, "partner_payout_one_open_idx")) {
      return {
        ok: false as const,
        error: "You already have a withdrawal waiting. We'll settle that one first.",
      };
    }
    throw err;
  }
}

/** Two requests reached the same earnings. Named so the catch can tell. */
class PayoutRaced extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutRaced";
  }
}

/** Postgres 23505, optionally for one named index. */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (e.code === "23505") {
    return !constraint || e.constraint === constraint || !e.constraint;
  }
  // Drizzle wraps the driver error on some paths.
  return e.cause ? isUniqueViolation(e.cause, constraint) : false;
}

/** Approve, pay or reject a request. Superadmin only; the route enforces that. */
export async function decidePayout(opts: {
  payoutId: string;
  status: "approved" | "paid" | "rejected";
  reference?: string | null;
  note?: string | null;
  decidedBy: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .select({ id: partnerPayout.id, status: partnerPayout.status })
    .from(partnerPayout)
    .where(eq(partnerPayout.id, opts.payoutId))
    .limit(1);
  if (!row) return { ok: false, error: "We couldn't find that request." };
  if (row.status === "paid") return { ok: false, error: "That one is already paid." };

  await db.transaction(async (tx) => {
    await tx
      .update(partnerPayout)
      .set({
        status: opts.status,
        reference: opts.reference?.trim() || null,
        note: opts.note?.trim() || null,
        decidedBy: opts.decidedBy,
        decidedAt: new Date(),
        paidAt: opts.status === "paid" ? new Date() : null,
      })
      .where(eq(partnerPayout.id, opts.payoutId));

    if (opts.status === "paid") {
      await tx
        .update(partnerEarning)
        .set({ status: "paid" })
        .where(eq(partnerEarning.payoutId, opts.payoutId));
    }

    if (opts.status === "rejected") {
      /*
       * Rejecting hands the money BACK, it does not destroy it. The earnings
       * return to available and the Partner can request again — anything else
       * would quietly take money somebody had earned.
       */
      await tx
        .update(partnerEarning)
        .set({ payoutId: null, status: "available" })
        .where(eq(partnerEarning.payoutId, opts.payoutId));
    }
  });

  return { ok: true };
}

/* ============================================================
 * Superadmin
 * ========================================================== */

export async function allPartners() {
  /*
   * Two queries and a join in JS, not a correlated subquery.
   *
   * The first version counted churches with
   *
   *     sql`(select count(*) from partner_referral where partner_id = id)`
   *
   * which is the trap written up in AGENTS.md: with no join in the outer
   * query drizzle drops the table qualifier, Postgres binds BOTH names to the
   * inner table, and the count comes back as every referral in the system for
   * every partner — silently, with no error. `sql-safety.test.ts` caught it,
   * which is exactly what that test exists for.
   */
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: partner.id,
        code: partner.code,
        displayName: partner.displayName,
        status: partner.status,
        phone: partner.phone,
        emailVerifiedAt: partner.emailVerifiedAt,
        phoneVerifiedAt: partner.phoneVerifiedAt,
        tierOverride: partner.tierOverride,
        createdAt: partner.createdAt,
      })
      .from(partner)
      .orderBy(desc(partner.createdAt)),
    db
      .select({
        partnerId: partnerReferral.partnerId,
        c: sql<number>`count(*)::int`,
      })
      .from(partnerReferral)
      .groupBy(partnerReferral.partnerId),
  ]);

  const byPartner = new Map(counts.map((c) => [c.partnerId, Number(c.c)]));
  return rows.map((r) => ({ ...r, churches: byPartner.get(r.id) ?? 0 }));
}

export async function pendingPayouts() {
  return db
    .select({
      id: partnerPayout.id,
      amount: partnerPayout.amount,
      currency: partnerPayout.currency,
      status: partnerPayout.status,
      bankName: partnerPayout.bankName,
      bankAccountNumber: partnerPayout.bankAccountNumber,
      bankAccountName: partnerPayout.bankAccountName,
      requestedAt: partnerPayout.requestedAt,
      partnerName: partner.displayName,
      partnerCode: partner.code,
    })
    .from(partnerPayout)
    .innerJoin(partner, eq(partner.id, partnerPayout.partnerId))
    .where(inArray(partnerPayout.status, ["requested", "approved"]))
    .orderBy(asc(partnerPayout.requestedAt));
}

export async function setPartnerStatus(opts: {
  partnerId: string;
  status: "pending" | "active" | "suspended";
  tierOverride?: string | null;
  note?: string | null;
}): Promise<void> {
  await db
    .update(partner)
    .set({
      status: opts.status,
      tierOverride: opts.tierOverride?.trim() || null,
      note: opts.note?.trim() || null,
    })
    .where(eq(partner.id, opts.partnerId));
}

export async function partnerTierNow(
  partnerId: string,
  tierOverride: string | null,
): Promise<{ tier: PartnerTier; liveChurches: number; rates: PartnerRates }> {
  const rates = await getPartnerRates();
  const liveChurches = await livePayingChurches(partnerId, rates);
  return { tier: tierFor(rates, liveChurches, tierOverride), liveChurches, rates };
}
