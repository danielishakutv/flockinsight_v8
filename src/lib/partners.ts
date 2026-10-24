import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  partner,
  partnerEarning,
  partnerPayout,
  partnerReferral,
  payment,
  platformSetting,
  user,
} from "@/db/schema";
import {
  DEFAULT_PARTNER_RATES,
  bankDetailsChanged,
  canonicalPhone,
  commissionBase,
  dropRepeatedOneOffs,
  earningNote,
  earningsForPayment,
  generatePartnerCode,
  normalisePartnerCode,
  normaliseRates,
  otpDestination,
  PAYOUT_TRANSITIONS,
  payoutTransitionAllowed,
  payoutTransitionError,
  takeForPayout,
  tierFor,
  walletTotals,
  type BankDetails,
  type PartnerRates,
  type PartnerStatus,
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
    try {
      const [row] = await db
        .insert(partner)
        .values({
          userId: opts.userId,
          code,
          displayName: opts.displayName.trim().slice(0, 120) || "Partner",
          // The gateway's spelling, the same as savePartnerPhone stores, so
          // the number a code is sent to and the number on file always match.
          phone: opts.phone ? canonicalPhone(opts.phone) || null : null,
          status: "pending",
        })
        .returning({ id: partner.id, code: partner.code });
      return { ok: true, id: row.id, code: row.code };
    } catch (e) {
      /*
       * Two unique constraints can refuse this, and they mean opposite things.
       * `partner_userId_unique` is a second tap of "Join" racing the first
       * past the check above — the person IS a Partner now, so say so. A code
       * that somebody else took between the check and the insert is a reason
       * to draw another.
       */
      const code23505 =
        (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code23505 !== "23505") throw e;
      if (await partnerForUser(opts.userId)) {
        return { ok: false, error: "This account is already a Partner." };
      }
    }
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
  source?: "link" | "code" | "portal";
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
 * ## It counts MONTHS, not payments
 *
 * What decides whether this earns the first commission, the second or the
 * trail is which month of the subscription is being paid for — and one payment
 * is not one month. A church paying for a year hands over a single payment
 * covering twelve of them, and counting payments made that payment the
 * church's "first" for ever: the Partner earned one commission, waited a year
 * for the second, and never saw a month of trail. So the months already bought
 * are summed from `periodMonths`, and this payment is priced across the months
 * it covers — which may award the first, the second AND the trail in one go.
 *
 * Counting rather than storing a flag means a refunded or corrected payment
 * changes the answer, instead of leaving a flag that disagrees with the money.
 *
 * ## A payment of zero is not a payment
 *
 * A free activation, a 100% discount and an admin setting a plan by hand all
 * record a successful payment of 0. Counted as a month, the church's first
 * real payment arrives as month two and the first commission is lost — paid to
 * nobody, for a payment that never happened. Only money counts.
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
        surchargeAmount: payment.surchargeAmount,
        currency: payment.currency,
        status: payment.status,
        periodMonths: payment.periodMonths,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .where(eq(payment.id, paymentId))
      .limit(1);
    if (!pay) return { awarded: false, reason: "no such payment" };
    if (pay.status !== "success") return { awarded: false, reason: "not successful" };
    // Its church was deleted after paying: the referral went with it, so
    // there is nobody to credit. Named, so the reconcile sweep can say why.
    const churchId = pay.churchId;
    if (!churchId) return { awarded: false, reason: "church deleted" };

    const [ref] = await db
      .select({ partnerId: partnerReferral.partnerId })
      .from(partnerReferral)
      .where(eq(partnerReferral.churchId, churchId))
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

    // Read before the lock: neither depends on this church's ledger, and the
    // tier query is the slowest thing here.
    const rates = await getPartnerRates();
    const tier = tierFor(rates, await livePayingChurches(p.id, rates), p.tierOverride);

    return await db.transaction(async (tx) => {
      /*
       * One church's payments are priced one at a time.
       *
       * Which month a payment pays for depends on the church's OTHER payments
       * and on what they have already earned, so two awards for the same
       * church running together — a callback and a webhook for one payment, or
       * a card payment landing while a transfer is being recorded — could each
       * read the ledger before the other wrote to it and both come out as month
       * one. The referral row is the church's one row in this module, so
       * locking it queues them. Awards for different churches never wait.
       */
      await tx
        .select({ id: partnerReferral.id })
        .from(partnerReferral)
        .where(eq(partnerReferral.churchId, churchId))
        .for("update");

      /*
       * Still a success, read again under a share lock. A void takes this row
       * FOR UPDATE, so it either committed before this read (and there is
       * nothing to award) or waits until these earnings are written — and the
       * reversal that follows the void then finds them. Without it, an award
       * that read "success" just before a void could write its earnings just
       * after the reversal had looked, and the commission on money that never
       * arrived would stand.
       */
      const [still] = await tx
        .select({ status: payment.status })
        .from(payment)
        .where(eq(payment.id, pay.id))
        .for("share");
      if (still?.status !== "success") {
        return { awarded: false, reason: "not successful" };
      }

      /*
       * A payment is priced ONCE. If it has any earning at all, this is a
       * replay, and it stops here rather than pricing the payment again.
       *
       * The unique (payment, kind) index alone is not enough for that: a replay
       * that runs after a LATER payment has been awarded counts that later one
       * too (see below), arrives at a different month, and comes out as a kind
       * this payment does not have yet — a "second" on top of its "first". The
       * index lets that through, because it is a different kind.
       */
      const [already] = await tx
        .select({ id: partnerEarning.id })
        .from(partnerEarning)
        .where(eq(partnerEarning.paymentId, pay.id))
        .limit(1);
      if (already) return { awarded: false, reason: "already awarded" };

      /*
       * How many months of subscription this church had already paid for when
       * this payment came in, so it can be priced across the months it covers.
       *
       * "Already" is judged by two orders, and needs both.
       *
       * The order the rows were WRITTEN (created_at, then id): what was on the
       * ledger before this payment arrived. Without it, a bank transfer recorded
       * in November with the date it was paid — 1 September — counted nothing
       * before it, was priced as month one, and earned the first commission a
       * second time on top of the October and November card payments that had
       * already earned the first and the second.
       *
       * The order they were PAID (paid_at, then created_at, then id): what was
       * settled before this one. Without it, a card checkout started on day 1
       * and completed on day 6 would count nothing written before day 1 — and
       * miss the transfer recorded on day 5.
       *
       * When the two orders AGREE, that settles it. When they disagree (a
       * backdated row, or a slow checkout), the tie-break is the order the
       * payments were PRICED: the other payment counts as earlier only if it
       * has already been priced, i.e. already has earnings. Pricing for one
       * church is serialised by the lock above, so that is a strict order too,
       * and the rule is antisymmetric — of any two payments, exactly one counts
       * the other. A plain "either order says earlier" was not: a card checkout
       * written day 1 and paid day 6 and a transfer written and paid on day 5,
       * both successful before either was awarded (two awards back to back, or
       * a sweep retrying one that errored), each counted the other, both were
       * priced as month two, and the first commission went to nobody.
       * `partners-annual.db-check.ts` covers each of these.
       *
       * Loaded here, under the lock, as a plain list rather than a correlated
       * subquery: the outer query has no join, so a raw `sql` reference to
       * payment.id inside one would lose its qualifier (the AGENTS.md trap).
       */
      const pricedRows = await tx
        .selectDistinct({ paymentId: partnerEarning.paymentId })
        .from(partnerEarning)
        .where(
          and(
            eq(partnerEarning.churchId, churchId),
            isNotNull(partnerEarning.paymentId),
            ne(partnerEarning.paymentId, pay.id),
          ),
        );
      const pricedIds = pricedRows
        .map((r) => r.paymentId)
        .filter((id): id is string => !!id);

      const writtenEarlier = or(
        lt(payment.createdAt, pay.createdAt),
        and(eq(payment.createdAt, pay.createdAt), lt(payment.id, pay.id)),
      );
      const paidEarlier = pay.paidAt
        ? or(
            lt(payment.paidAt, pay.paidAt),
            and(
              eq(payment.paidAt, pay.paidAt),
              or(
                lt(payment.createdAt, pay.createdAt),
                and(eq(payment.createdAt, pay.createdAt), lt(payment.id, pay.id)),
              ),
            ),
          )
        : undefined;
      const countsAsEarlier = paidEarlier
        ? or(
            // Both orders agree. A row with no paid_at has no second opinion,
            // so its written order stands on its own, as it always did.
            and(writtenEarlier, or(paidEarlier, isNull(payment.paidAt))),
            // They disagree: whichever was priced first is the earlier one.
            pricedIds.length
              ? and(or(writtenEarlier, paidEarlier), inArray(payment.id, pricedIds))
              : undefined,
          )
        : writtenEarlier;

      const months = Math.max(1, Number(pay.periodMonths) || 1);
      const [counted] = await tx
        .select({ m: sql<number>`coalesce(sum(${payment.periodMonths}), 0)::int` })
        .from(payment)
        .where(
          and(
            eq(payment.churchId, churchId),
            eq(payment.status, "success"),
            // Only money. A zero-naira activation is not a month the Partner
            // earns on, and counting it would consume the first commission.
            gt(payment.amount, 0),
            ne(payment.id, pay.id),
            countsAsEarlier,
          ),
        );
      const firstMonth = Math.max(1, Number(counted?.m ?? 0) + 1);

      const priced = earningsForPayment({
        rates,
        tier,
        // The plan's price, not the international card surcharge on top of it.
        amount: commissionBase(Number(pay.amount), Number(pay.surchargeAmount)),
        firstMonth,
        months,
      });

      /*
       * And the last word on the two big commissions: a church that has
       * already earned its first (or second) on a payment that still stands
       * does not earn it again, whatever the count above concluded. A voided
       * payment no longer stands — its commission was reversed — so it does
       * not block the payment that has really become the first.
       */
      const earned = await tx
        .select({ kind: partnerEarning.kind })
        .from(partnerEarning)
        .innerJoin(payment, eq(payment.id, partnerEarning.paymentId))
        .where(
          and(
            eq(partnerEarning.churchId, churchId),
            ne(partnerEarning.paymentId, pay.id),
            inArray(partnerEarning.kind, ["first", "second"]),
            ne(partnerEarning.status, "cancelled"),
            eq(payment.status, "success"),
          ),
        );
      const { kept: lines, dropped } = dropRepeatedOneOffs(
        priced,
        earned.map((e) => e.kind),
      );
      if (dropped.length) {
        console.warn(
          `[partners] payment ${pay.id}: not awarding ${dropped
            .map((d) => d.kind)
            .join(" + ")} again — church ${churchId} already earned it ` +
            `(priced from month ${firstMonth})`,
        );
      }
      if (lines.length === 0) {
        return { awarded: false, reason: "nothing earned at this point" };
      }

      /*
       * Available straight away, because the holding-back is already expressed
       * by WHICH MONTH earns what: the second commission is not released on a
       * timer, it is simply not earned until the church has paid for its second
       * month — which a church paying for a year has already done, today, which
       * is the whole point. A "pending" status is left in the schema for a
       * future rule that needs it (a refund window, say) rather than used to
       * fake one now.
       */
      const inserted = await tx
        .insert(partnerEarning)
        .values(
          lines.map((line) => ({
            partnerId: p.id,
            churchId: churchId,
            paymentId: pay.id,
            kind: line.kind,
            amount: line.amount,
            currency: pay.currency,
            rateBps: line.rateBps,
            status: "available" as const,
            // Why this row is the size it is, for a payment covering several
            // months. Null for an ordinary monthly one, where there is nothing
            // to explain.
            note: earningNote(line, months),
          })),
        )
        /*
         * One row per kind, which keeps the unique index as the database's
         * own guarantee of idempotence underneath the lock and the check
         * above. It is also why the months of one kind are summed into a
         * single row upstream rather than inserted one per month.
         */
        .onConflictDoNothing({
          target: [partnerEarning.paymentId, partnerEarning.kind],
        })
        .returning({ id: partnerEarning.id });

      return {
        awarded: inserted.length > 0,
        reason: inserted.length ? undefined : "already awarded",
      };
    });
  } catch (e) {
    // Logged and swallowed, deliberately: the church has paid, and a
    // commission that failed to record must not turn that into a failed
    // payment. The ledger can be reconciled; a lost payment cannot. The
    // reconcile cron retries any recent payment still without an earning.
    console.error("[partners] could not award a commission", e);
    return { awarded: false, reason: "error" };
  }
}

/**
 * How many of a Partner's churches are live AND paying in the rolling window.
 *
 * The tier qualifies on this rather than on sign-ups, which is the whole
 * difference between rewarding work and paying for churn.
 *
 * "Paying" is paid MONEY covering any part of the window — the months a
 * payment bought, not the day it was made:
 *
 *   - a church that paid for a year four months ago is paying today. Counted by
 *     the day of the payment it dropped out after 90 days, and a Partner whose
 *     churches all pay annually fell a tier — and was paid less on every new
 *     commission — for being better at their job;
 *   - a ₦0 row is not paying. An admin setting a plan by hand, or a 100%
 *     discount, records a "successful" payment of nothing, and counting those
 *     let a Partner climb tiers on churches that pay nothing — the same rule
 *     the month count in awardPartnerCommission already uses.
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
        gt(payment.amount, 0),
        isNotNull(payment.paidAt),
        /*
         * The period this payment bought still reaches into the window. The
         * query is joined, so drizzle qualifies these columns; this is not
         * the correlated-subquery trap in AGENTS.md.
         */
        sql`${payment.paidAt} + make_interval(months => greatest(${payment.periodMonths}, 1)) >= ${since.toISOString()}::timestamptz`,
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
      .where(
        and(
          inArray(payment.churchId, ids),
          eq(payment.status, "success"),
          // Money only, as the commission counts it. A ₦0 activation listed
          // as a payment had a Partner asking where its commission was.
          gt(payment.amount, 0),
        ),
      )
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
          // A cancelled earning was never theirs; a reversal (negative) is
          // counted, so the figure is what the church has really earned them.
          ne(partnerEarning.status, "cancelled"),
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
      // Set only when one payment covered several months — "months 3–12 of a
      // 12-month payment". Without it, a Partner looking at an annual church
      // sees three rows in one day and has no way to tell what each is for.
      note: partnerEarning.note,
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
}): Promise<
  /** `amount` is what was recorded: the whole earnings taken, debts netted in. */
  { ok: true; id: string; amount: number } | { ok: false; error: string }
> {
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

      // Take whole earnings until the request is covered — every reversal
      // (a negative row) included first, so a debt is always settled by the
      // withdrawal it is owed against. Splitting a row would make the ledger
      // stop explaining itself for the sake of a few kobo.
      const take = takeForPayout(
        rows.map((r) => ({ id: r.id, amount: Number(r.amount) })),
        opts.amount,
      );
      if (!take) {
        return { ok: false as const, error: "There is nothing available to withdraw." };
      }
      const taken = take.ids;
      const running = take.total;

      // What is actually being paid is the earnings taken, not the number
      // typed — so the payout and the ledger can never disagree.
      const recorded = Math.round(running * 100) / 100;
      const [payout] = await tx
        .insert(partnerPayout)
        .values({
          partnerId: opts.partnerId,
          amount: recorded,
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

      // Returned so the notice the Partner receives names the figure that
      // will actually be transferred, not the one they typed.
      return { ok: true as const, id: payout.id, amount: recorded };
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

/**
 * Approve, pay or reject a request. Superadmin only; the route enforces that.
 *
 * The decision is a state machine (PAYOUT_TRANSITIONS in partners-shared), and
 * it is held where two people cannot both pass it:
 *
 * - the payout row is locked (`for update`) before its status is read, so a
 *   second decision on the same request waits for the first and then reads
 *   what the first wrote — not the "requested" it saw on its page;
 * - the UPDATE repeats the allowed-from statuses and counts what came back. If
 *   that is not exactly one row the transaction is thrown away.
 *
 * Before this, the only check was "not already paid", read outside the
 * transaction. A request rejected in one tab had its earnings handed back,
 * the Partner asked again, and a stale tab could still mark the OLD request
 * paid — two transfers for one balance. And a reject landing just after a
 * "paid" handed money already paid back to "available", to be withdrawn again.
 */
export async function decidePayout(opts: {
  payoutId: string;
  status: "approved" | "paid" | "rejected";
  reference?: string | null;
  note?: string | null;
  decidedBy: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const from = PAYOUT_TRANSITIONS[opts.status];
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: partnerPayout.id, status: partnerPayout.status })
        .from(partnerPayout)
        .where(eq(partnerPayout.id, opts.payoutId))
        .for("update")
        .limit(1);
      if (!row) return { ok: false as const, error: "We couldn't find that request." };
      if (!payoutTransitionAllowed(row.status, opts.status)) {
        return { ok: false as const, error: payoutTransitionError(row.status, opts.status) };
      }

      const moved = await tx
        .update(partnerPayout)
        .set({
          status: opts.status,
          reference: opts.reference?.trim() || null,
          note: opts.note?.trim() || null,
          decidedBy: opts.decidedBy,
          decidedAt: new Date(),
          paidAt: opts.status === "paid" ? new Date() : null,
        })
        .where(
          and(
            eq(partnerPayout.id, opts.payoutId),
            // Repeated, so the UPDATE itself refuses a request that has moved.
            inArray(partnerPayout.status, [...from]),
          ),
        )
        .returning({ id: partnerPayout.id });
      if (moved.length !== 1) {
        throw new PayoutRaced(
          `decide ${opts.status} on ${opts.payoutId} moved ${moved.length} rows`,
        );
      }

      if (opts.status === "paid") {
        await tx
          .update(partnerEarning)
          .set({ status: "paid" })
          .where(
            and(
              eq(partnerEarning.payoutId, opts.payoutId),
              eq(partnerEarning.status, "available"),
            ),
          );
      }

      if (opts.status === "rejected") {
        /*
         * Rejecting hands the money BACK, it does not destroy it. The earnings
         * return to available and the Partner can request again — anything else
         * would quietly take money somebody had earned. Never a paid row: the
         * transition table already refuses rejecting a paid request, and this
         * is the same rule said a second time, at the rows it protects.
         */
        await tx
          .update(partnerEarning)
          .set({ payoutId: null, status: "available" })
          .where(
            and(
              eq(partnerEarning.payoutId, opts.payoutId),
              ne(partnerEarning.status, "paid"),
            ),
          );
      }

      return { ok: true as const };
    });
  } catch (err) {
    if (err instanceof PayoutRaced) {
      console.warn(`[partners] payout decision rolled back: ${err.message}`);
      return {
        ok: false,
        error: "Someone else just decided this request. Refresh the page.",
      };
    }
    throw err;
  }
}

/* ============================================================
 * Reversing a commission
 * ========================================================== */

export type ReverseCommissionResult =
  | {
      ok: true;
      /** Earnings still in the wallet, now cancelled. */
      cancelled: number;
      /** Naira already withdrawn or requested, now owed back as a negative row. */
      clawedBack: number;
      /** True when this payment had been reversed before; nothing changed. */
      already: boolean;
    }
  | { ok: false; error: string };

/**
 * Take back the commission on a payment that has been voided.
 *
 * Called by superadmin after a SUCCESSFUL payment is voided (a bounced
 * transfer, a refund, a mistyped amount). Without it a Partner kept — and
 * could withdraw — commission on money that never arrived.
 *
 * Two cases, because money is a ledger and a paid row is history:
 *
 * - an earning still sitting in the wallet (not in any withdrawal) is
 *   CANCELLED. It was never withdrawn, so there is nothing to recover; it
 *   simply stops counting;
 * - an earning already inside a withdrawal — requested, approved or paid —
 *   is left exactly as it is, and ONE negative `reversal` row for the same
 *   total is written against the payment. It is deducted from the Partner's
 *   next withdrawal (takeForPayout always takes it first). If the withdrawal
 *   is later rejected, the earning comes back to the wallet and the reversal
 *   still nets it to zero, which is the right answer either way.
 *
 * Idempotent: the reversal row is unique on (payment, kind), and a payment
 * that already has one is left alone — a second call after a rejected
 * withdrawal must not cancel the returned earning AND keep the debt for it.
 *
 * Never throws into the caller. A void has already been committed by the time
 * this runs; a reversal that failed is logged, written to the audit trail as
 * critical with the payment id, and reported in the result.
 */
export async function reversePartnerCommission(
  paymentId: string,
): Promise<ReverseCommissionResult> {
  try {
    return await db.transaction(async (tx) => {
      // Locked, so a withdrawal being requested right now either took these
      // rows before us (and we see the payout id) or waits until we are done.
      const rows = await tx
        .select({
          id: partnerEarning.id,
          partnerId: partnerEarning.partnerId,
          churchId: partnerEarning.churchId,
          kind: partnerEarning.kind,
          amount: partnerEarning.amount,
          currency: partnerEarning.currency,
          status: partnerEarning.status,
          payoutId: partnerEarning.payoutId,
        })
        .from(partnerEarning)
        .where(eq(partnerEarning.paymentId, paymentId))
        .for("update");

      if (rows.some((r) => r.kind === "reversal")) {
        return { ok: true as const, cancelled: 0, clawedBack: 0, already: true };
      }

      const earnings = rows.filter((r) => Number(r.amount) > 0 && r.status !== "cancelled");
      const inWallet = earnings.filter(
        (r) => !r.payoutId && (r.status === "available" || r.status === "pending"),
      );
      const gone = earnings.filter((r) => !inWallet.includes(r));

      if (inWallet.length) {
        const cancelled = await tx
          .update(partnerEarning)
          .set({
            status: "cancelled",
            note: sql`concat_ws(' · ', ${partnerEarning.note}, 'Cancelled: the payment was voided')`,
          })
          .where(
            and(
              inArray(
                partnerEarning.id,
                inWallet.map((r) => r.id),
              ),
              // Repeated: only a row still in the wallet may be cancelled.
              isNull(partnerEarning.payoutId),
              inArray(partnerEarning.status, ["available", "pending"]),
            ),
          )
          .returning({ id: partnerEarning.id });
        if (cancelled.length !== inWallet.length) {
          throw new PayoutRaced(
            `reversal of ${paymentId} cancelled ${cancelled.length} of ${inWallet.length} earnings`,
          );
        }
      }

      const owed = Math.round(gone.reduce((sum, r) => sum + Number(r.amount), 0) * 100) / 100;
      if (owed > 0) {
        const first = gone[0];
        await tx
          .insert(partnerEarning)
          .values({
            partnerId: first.partnerId,
            churchId: first.churchId,
            paymentId,
            kind: "reversal",
            amount: -owed,
            currency: first.currency,
            rateBps: 0,
            status: "available",
            note: "A payment you earned commission on was voided. Deducted from your next withdrawal.",
          })
          .onConflictDoNothing({
            target: [partnerEarning.paymentId, partnerEarning.kind],
          });
      }

      return {
        ok: true as const,
        cancelled: inWallet.length,
        clawedBack: owed,
        already: false,
      };
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[partners] could not reverse the commission on payment ${paymentId}`, e);
    try {
      const { auditSystem } = await import("@/lib/audit");
      await auditSystem({
        action: "platform.partner.commission_reverse_failed",
        summary: `Partner commission on voided payment ${paymentId} was NOT reversed: ${error}. Reverse it by hand before the Partner's next withdrawal is paid.`,
        targetType: "payment",
        targetId: paymentId,
        severity: "critical",
        meta: { paymentId, error },
      });
    } catch (auditErr) {
      console.error(
        `[partners] and the audit entry for that failure could not be written either (payment ${paymentId})`,
        auditErr,
      );
    }
    return { ok: false, error };
  }
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
        // The login's address, so the list can be searched by the email a
        // Partner writes in from.
        email: user.email,
        emailVerifiedAt: partner.emailVerifiedAt,
        phoneVerifiedAt: partner.phoneVerifiedAt,
        tierOverride: partner.tierOverride,
        createdAt: partner.createdAt,
      })
      .from(partner)
      .innerJoin(user, eq(user.id, partner.userId))
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
      partnerId: partner.id,
      partnerName: partner.displayName,
      partnerCode: partner.code,
      // So the queue can say "paused — don't transfer" beside a request made
      // before the hold. The request itself is left alone: a transfer that
      // already went out must still be recordable as paid.
      partnerStatus: partner.status,
    })
    .from(partnerPayout)
    .innerJoin(partner, eq(partner.id, partnerPayout.partnerId))
    .where(inArray(partnerPayout.status, ["requested", "approved"]))
    .orderBy(asc(partnerPayout.requestedAt));
}

/**
 * Change a Partner's status, and nothing else.
 *
 * It used to take the tier override and the note as well and write whatever
 * came in, so the status dropdown — which sent neither — blanked the note and
 * kept the override only because it happened to be passed back. A status
 * change now cannot touch a field it was not about.
 *
 * The reason is kept only while it explains something: paused or suspended.
 * `statusChangedAt` moves only when the status does, so correcting the wording
 * of a reason does not reset "paused since".
 */
export async function setPartnerStatus(opts: {
  partnerId: string;
  status: PartnerStatus;
  reason?: string | null;
}): Promise<
  | { ok: true; before: PartnerStatus; changed: boolean }
  | { ok: false; error: string }
> {
  const [row] = await db
    .select({ status: partner.status })
    .from(partner)
    .where(eq(partner.id, opts.partnerId))
    .limit(1);
  if (!row) return { ok: false, error: "That Partner no longer exists." };

  const holding = opts.status === "paused" || opts.status === "suspended";
  const changed = row.status !== opts.status;
  await db
    .update(partner)
    .set({
      status: opts.status,
      statusReason: holding ? opts.reason?.trim() || null : null,
      ...(changed ? { statusChangedAt: new Date() } : {}),
    })
    .where(eq(partner.id, opts.partnerId));
  return { ok: true, before: row.status, changed };
}

/**
 * The details superadmin can correct on a Partner's behalf.
 *
 * A changed phone number loses its verification exactly as it does when the
 * Partner changes it themselves (`savePartnerPhone`): a verification that
 * survives the number changing is not a verification. The same number in a
 * different spelling keeps it, and is stored in the gateway's spelling.
 *
 * The tier override must name a tier on the current ladder. `tierFor` falls
 * back to the earned tier for a name it cannot find, so a typo here would
 * look saved and do nothing.
 */
export async function updatePartnerProfile(opts: {
  partnerId: string;
  displayName: string;
  phone: string | null;
  tierOverride: string | null;
  note: string | null;
}): Promise<
  | { ok: true; changed: Record<string, { from: unknown; to: unknown }> }
  | { ok: false; error: string }
> {
  const [row] = await db
    .select({
      displayName: partner.displayName,
      phone: partner.phone,
      tierOverride: partner.tierOverride,
      note: partner.note,
    })
    .from(partner)
    .where(eq(partner.id, opts.partnerId))
    .limit(1);
  if (!row) return { ok: false, error: "That Partner no longer exists." };

  const typedPhone = opts.phone?.trim() ?? "";
  const phone = typedPhone ? otpDestination("phone", typedPhone) : "";
  if (typedPhone && !phone) {
    return { ok: false, error: "That phone number looks incomplete — check the digits." };
  }
  const storedPhone = row.phone ? otpDestination("phone", row.phone) : "";
  const phoneChanged = phone !== storedPhone;

  let tierOverride: string | null = null;
  if (opts.tierOverride?.trim()) {
    const rates = await getPartnerRates();
    const named = rates.tiers.find(
      (t) => t.name.toLowerCase() === opts.tierOverride!.trim().toLowerCase(),
    );
    if (!named) {
      return { ok: false, error: "That tier is not on the current ladder." };
    }
    tierOverride = named.name;
  }

  const next = {
    displayName: opts.displayName.trim().slice(0, 120) || row.displayName,
    phone: phone || null,
    tierOverride,
    note: opts.note?.trim() || null,
  };

  await db
    .update(partner)
    .set({ ...next, ...(phoneChanged ? { phoneVerifiedAt: null } : {}) })
    .where(eq(partner.id, opts.partnerId));

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  if (row.displayName !== next.displayName)
    changed.displayName = { from: row.displayName, to: next.displayName };
  if (phoneChanged) changed.phone = { from: row.phone, to: next.phone };
  if ((row.tierOverride ?? null) !== next.tierOverride)
    changed.tierOverride = { from: row.tierOverride, to: next.tierOverride };
  // The note's text stays out of the log — it is free text about a person.
  if ((row.note ?? null) !== next.note) changed.note = { from: "…", to: "…" };
  return { ok: true, changed };
}

/**
 * Mark a Partner's email or phone verified, or take the verification away.
 *
 * Marking one verified is a person vouching for it — they rang the number,
 * or the Partner wrote in from that inbox — and it opens a gate on
 * withdrawing, so the action that calls this records who did it. A phone can
 * only be vouched for if there is one.
 */
export async function setPartnerVerification(opts: {
  partnerId: string;
  which: "email" | "phone";
  verified: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .select({ phone: partner.phone })
    .from(partner)
    .where(eq(partner.id, opts.partnerId))
    .limit(1);
  if (!row) return { ok: false, error: "That Partner no longer exists." };
  if (opts.which === "phone" && opts.verified && !row.phone) {
    return { ok: false, error: "Add a phone number before marking it verified." };
  }
  const at = opts.verified ? new Date() : null;
  await db
    .update(partner)
    .set(opts.which === "email" ? { emailVerifiedAt: at } : { phoneVerifiedAt: at })
    .where(eq(partner.id, opts.partnerId));
  return { ok: true };
}

/**
 * Superadmin sets where a Partner's withdrawals are paid.
 *
 * Unlike the Partner's own change, this does not clear their email
 * verification — the reason for that rule is a stolen session, and this is
 * not one. They are still told, by the caller, because a payout account that
 * changes without the owner hearing about it is the thing to never allow.
 *
 * Open withdrawal requests keep the account they were requested to: each
 * payout snapshots the bank details when it is made.
 */
export async function setPartnerBankByAdmin(opts: {
  partnerId: string;
  bank: BankDetails;
}): Promise<
  | { ok: true; changed: boolean; hadAccount: boolean }
  | { ok: false; error: string }
> {
  const [row] = await db
    .select({
      bankName: partner.bankName,
      bankAccountNumber: partner.bankAccountNumber,
      bankAccountName: partner.bankAccountName,
    })
    .from(partner)
    .where(eq(partner.id, opts.partnerId))
    .limit(1);
  if (!row) return { ok: false, error: "That Partner no longer exists." };
  await db
    .update(partner)
    .set({
      bankName: opts.bank.bankName,
      bankAccountNumber: opts.bank.bankAccountNumber,
      bankAccountName: opts.bank.bankAccountName,
    })
    .where(eq(partner.id, opts.partnerId));
  return {
    ok: true,
    changed: bankDetailsChanged(row, opts.bank),
    hadAccount: !!(row.bankName || row.bankAccountNumber || row.bankAccountName),
  };
}

export async function partnerTierNow(
  partnerId: string,
  tierOverride: string | null,
): Promise<{ tier: PartnerTier; liveChurches: number; rates: PartnerRates }> {
  const rates = await getPartnerRates();
  const liveChurches = await livePayingChurches(partnerId, rates);
  return { tier: tierFor(rates, liveChurches, tierOverride), liveChurches, rates };
}
