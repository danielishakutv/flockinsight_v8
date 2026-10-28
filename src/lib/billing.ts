import "server-only";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";
import { parsePlanKey, planKeyOf, type PlanId } from "@/lib/plans";
import { getCustomPlan, planKeyName } from "@/lib/plan-catalog";
import { applyDiscount, getPlanPrice } from "@/lib/pricing";
import { paystackVerify } from "@/lib/paystack";
import { classifyCharge, referenceKind } from "@/lib/paystack-outcome";
import {
  conversionSentence,
  nextRenewal,
  rollbackRenewal,
  type PeriodResult,
} from "@/lib/plan-period";
import { awardReferralIfDue } from "@/lib/referrals";
import { awardPartnerCommission } from "@/lib/partners";
import { auditSystem } from "@/lib/audit";
import { settleTopup, type DbTx } from "@/lib/wallet";
import type { SettleResult } from "@/lib/paystack-outcome";

/**
 * Monthly price after an admin-granted discount, using the admin-managed base
 * price. null = custom (Enterprise). Async because the base price is resolved
 * from platform settings.
 */
export async function effectivePrice(
  plan: string,
  discountPct: number,
): Promise<number | null> {
  return applyDiscount(await planKeyPrice(plan), discountPct);
}

/**
 * The list price of a plan KEY: a tier ("growth") from the pricing page, a
 * custom plan ("custom:<id>") from its own row. Null = custom / contact us.
 */
async function planKeyPrice(key: string): Promise<number | null> {
  const parsed = parsePlanKey(key);
  if (parsed && "customId" in parsed) {
    const c = await getCustomPlan(parsed.customId);
    return c ? c.priceMonthly : null;
  }
  return getPlanPrice(key);
}

/**
 * What a church is being put on: a tier, or a custom plan (which also names
 * the tier it starts from, for `church.plan`). A bare tier id is accepted
 * everywhere a choice is, and clears any custom plan.
 */
export type PlanChoice = { plan: PlanId; customPlanId: string | null };

const asChoice = (p: PlanId | PlanChoice): PlanChoice =>
  typeof p === "string" ? { plan: p, customPlanId: null } : p;

export type ActivateOptions = {
  /** Run inside this transaction (the payment claim's), rather than a new one. */
  tx?: DbTx;
  /**
   * Revalue remaining paid time when the tier changes (see lib/plan-period).
   * On for anything a church pays for itself; off for a superadmin grant,
   * where the operator chose the months.
   */
  convertRemaining?: boolean;
};

async function applyPlanPeriod(
  tx: DbTx,
  churchId: string,
  target: PlanChoice,
  months: number,
  convertRemaining: boolean,
): Promise<PeriodResult> {
  /*
   * Locked, because the new date is computed FROM the old one. Two payments
   * settling at once (a callback and the webhook for different references,
   * or a superadmin confirming while a church pays) would otherwise both read
   * the same renewal date and the second would erase the first's months.
   */
  const [c] = await tx
    .select({
      plan: church.plan,
      customPlanId: church.customPlanId,
      renewsAt: church.planRenewsAt,
      trialEndsAt: church.trialEndsAt,
      discount: church.planDiscountPct,
    })
    .from(church)
    .where(eq(church.id, churchId))
    .for("update")
    .limit(1);
  if (!c) throw new Error(`activatePlan: church ${churchId} not found`);

  /*
   * Compared as plan KEYS, so moving between a tier and a custom plan built
   * on that same tier is a change of plan — the two can cost very different
   * amounts, and remaining time is revalued exactly as between two tiers.
   */
  const currentKey = planKeyOf(c);
  const newKey = planKeyOf(target);
  const changing = currentKey !== newKey;
  const [currentMonthly, newMonthly] =
    changing && convertRemaining
      ? await Promise.all([
          effectivePrice(currentKey, c.discount),
          effectivePrice(newKey, c.discount),
        ])
      : [null, null];

  const period = nextRenewal({
    now: new Date(),
    currentPlan: currentKey,
    renewsAt: c.renewsAt,
    trialEndsAt: c.trialEndsAt,
    plan: newKey,
    months,
    currentMonthly,
    newMonthly,
    convertRemaining,
  });
  await tx
    .update(church)
    .set({
      plan: target.plan,
      customPlanId: target.customPlanId,
      planRenewsAt: period.renewsAt,
    })
    .where(eq(church.id, churchId));
  return period;
}

/**
 * Set a church's plan and extend its renewal date by `months`.
 *
 * Extends from the later of now, the current renewal date and the end of the
 * free trial — so renewing early, or paying during the trial, never loses
 * time. A change of tier revalues what is left when `convertRemaining` is on;
 * the rule and its reasons are in lib/plan-period.ts.
 */
export async function activatePlan(
  churchId: string,
  plan: PlanId | PlanChoice,
  months: number,
  opts: ActivateOptions = {},
): Promise<Date> {
  const convert = opts.convertRemaining ?? false;
  const target = asChoice(plan);
  const period = opts.tx
    ? await applyPlanPeriod(opts.tx, churchId, target, months, convert)
    : await db.transaction((tx) => applyPlanPeriod(tx, churchId, target, months, convert));
  return period.renewsAt;
}

/** A row a superadmin voided. Never honoured again, whatever Paystack says later. */
export const notVoided = sql`coalesce(${payment.note}, '') not like 'Voided:%'`;

export type ClaimedPayment = {
  id: string;
  /** Null when the church that paid has since been deleted. */
  churchId: string | null;
  plan: PlanId;
  /** The custom plan the payment bought, if it was one. */
  customPlanId: string | null;
  amount: number;
  periodMonths: number;
  renewsAt: Date | null;
  conversion: PeriodResult["conversion"];
};

/**
 * Turn one payment into paid time, exactly once.
 *
 * The ONE function that honours a subscription payment: the browser
 * callback, the Paystack webhook, the reconcile cron and a superadmin's
 * "mark received" all come through here. It used to be four copies of
 * "read the row, see pending, mark success, extend the plan", and two of
 * them arriving together — a refresh on a slow phone, the webhook racing the
 * redirect — both saw pending and both extended: an annual payment bought
 * twenty-four months.
 *
 * Now the claim IS the check: a conditional UPDATE ... RETURNING, which only
 * one of any number of concurrent callers can win, in the same transaction as
 * the plan extension. A crash between the two rolls both back, so a payment is
 * never marked paid without the months it paid for.
 *
 * Returns null when there was nothing to claim (already honoured, voided, or
 * not in a claimable state).
 */
export async function claimSubscriptionPayment(
  paymentId: string,
  opts: {
    /**
     * Also accept a row an earlier verify marked failed (abandoned
     * checkouts can still complete). A voided row is never accepted.
     */
    allowFailed: boolean;
    convertRemaining: boolean;
    /** Who honoured it, for the audit line. */
    actorName: string;
  },
): Promise<ClaimedPayment | null> {
  const claimable = opts.allowFailed
    ? or(eq(payment.status, "pending"), and(eq(payment.status, "failed"), notVoided))
    : eq(payment.status, "pending");

  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(payment)
      .set({ status: "success", paidAt: new Date() })
      .where(and(eq(payment.id, paymentId), claimable))
      .returning({
        id: payment.id,
        churchId: payment.churchId,
        plan: payment.plan,
        customPlanId: payment.customPlanId,
        amount: payment.amount,
        periodMonths: payment.periodMonths,
        extendsPlan: payment.extendsPlan,
      });
    if (!row) return null;
    const bought: PlanChoice = { plan: row.plan, customPlanId: row.customPlanId };

    let period: PeriodResult | null = null;
    /*
     * A payment whose church has been deleted still clears — the money
     * arrived, and the row is what a dispute is settled against — but there is
     * no plan left to extend.
     */
    if (row.churchId && row.extendsPlan && row.periodMonths > 0) {
      period = await applyPlanPeriod(
        tx,
        row.churchId,
        bought,
        row.periodMonths,
        opts.convertRemaining,
      );
      if (period.conversion) {
        // On the row, so support can see why the date moved the way it did.
        const line = conversionSentence(
          period.conversion,
          await planKeyName(planKeyOf(bought)),
          await planKeyName(period.conversion.fromPlan),
        );
        await tx
          .update(payment)
          .set({
            note: sql`case when ${payment.note} is null or ${payment.note} = '' then ${line}::text else ${payment.note} || ' · ' || ${line}::text end`,
          })
          .where(eq(payment.id, row.id));
      }
    }
    return {
      id: row.id,
      churchId: row.churchId,
      plan: row.plan,
      customPlanId: row.customPlanId,
      amount: Number(row.amount),
      periodMonths: row.periodMonths,
      renewsAt: period?.renewsAt ?? null,
      conversion: period?.conversion ?? null,
    } satisfies ClaimedPayment;
  });
  if (!claimed) return null;

  await payAwardsFor(claimed.id);

  const [boughtName, fromName] = await Promise.all([
    planKeyName(planKeyOf(claimed)),
    claimed.conversion ? planKeyName(claimed.conversion.fromPlan) : Promise.resolve(""),
  ]);
  await auditSystem({
    churchId: claimed.churchId,
    actorName: opts.actorName,
    action: "billing.payment.confirm",
    summary: `Payment of ₦${claimed.amount.toLocaleString()} confirmed for the ${boughtName} plan${
      claimed.renewsAt ? ` — paid through ${claimed.renewsAt.toDateString()}` : ""
    }${claimed.conversion ? ` (${claimed.conversion.fromDays} days of ${fromName} became ${claimed.conversion.toDays})` : ""}`,
    targetType: "payment",
    targetId: claimed.id,
    meta: {
      amount: claimed.amount,
      months: claimed.periodMonths,
      renewsAt: claimed.renewsAt?.toISOString() ?? null,
      conversion: claimed.conversion,
    },
    severity: "notice",
  });
  return claimed;
}

/**
 * What a successful payment owes OTHER people: the church-to-church referral
 * reward and the Partner's commission.
 *
 * After the claim's commit, never inside it: a commission or a referral that
 * failed to record must not roll back a payment the church has already made.
 * Both are idempotent (a conditional claim on the church row; a unique index
 * on the earning) and both log rather than throw — which is exactly why they
 * cannot be run ONCE. Only the caller that won the claim used to reach here;
 * if its award failed, or the process died between the commit and the award,
 * every later callback, webhook and reconcile run saw "success" and returned
 * before getting this far, and the Partner was never paid. So this runs on
 * every path that finds the payment honoured, and the reconcile cron sweeps
 * recent payments for anything still owed (sweepUnpaidAwards).
 *
 * The referral is paid on real money only — a ₦0 activation is not a first
 * payment — and only while the row is still a success: the payment is read
 * again here, because a void can land between a caller's read and this call,
 * and the referral (unlike the commission) has no payment of its own to check.
 */
export async function payAwardsFor(paymentId: string): Promise<void> {
  const [p] = await db
    .select({ churchId: payment.churchId, amount: payment.amount, status: payment.status })
    .from(payment)
    .where(eq(payment.id, paymentId))
    .limit(1);
  if (!p || p.status !== "success") return;
  // No church, no referral to reward: it was deleted after paying.
  if (p.churchId && Number(p.amount) > 0) await awardReferralIfDue(p.churchId);
  await awardPartnerCommission(paymentId);
}

export type { SettleResult };

/**
 * Settle a subscription checkout by asking Paystack what happened.
 *
 * Called with nothing but a reference, from anywhere, as often as anyone
 * likes: every path through it is idempotent.
 */
export async function settleSubscriptionPayment(
  reference: string,
  actorName = "Paystack",
): Promise<SettleResult> {
  const [p] = await db
    .select({
      id: payment.id,
      amount: payment.amount,
      status: payment.status,
      note: payment.note,
    })
    .from(payment)
    .where(eq(payment.reference, reference))
    .limit(1);
  if (!p) return "not-found";
  if (p.status === "success") {
    // Honoured already — but what it owes others may not have been paid yet.
    await payAwardsFor(p.id);
    return "already";
  }
  if (p.note?.startsWith("Voided:")) return "failed";

  const v = await paystackVerify(reference);
  const outcome = classifyCharge(v, Number(p.amount));

  switch (outcome) {
    case "unknown":
      // Says nothing about the payment. Leave it for the webhook or the cron.
      console.warn(`[billing] could not verify ${reference}`, v.ok ? null : v.error);
      return "unknown";
    case "pending":
      return "pending";
    case "failed":
      // Only a still-pending row, so a late "abandoned" can never overwrite a
      // success the webhook recorded a moment earlier.
      await db
        .update(payment)
        .set({ status: "failed" })
        .where(and(eq(payment.id, p.id), eq(payment.status, "pending")));
      return "failed";
    case "mismatch": {
      const got = v.ok ? `${v.amountKobo / 100} ${v.currency}` : "?";
      console.error(
        `[billing] ${reference}: Paystack reports ${got}, expected ₦${Number(p.amount)} — not honoured`,
      );
      const line = `Paystack reported ${got}; expected ₦${Number(p.amount).toLocaleString()} — needs review`;
      await db
        .update(payment)
        .set({
          note: sql`case when ${payment.note} is null or ${payment.note} = '' then ${line}::text when position(${line}::text in ${payment.note}) > 0 then ${payment.note} else ${payment.note} || ' · ' || ${line}::text end`,
        })
        .where(and(eq(payment.id, p.id), eq(payment.status, "pending")));
      return "mismatch";
    }
    case "success": {
      const claimed = await claimSubscriptionPayment(p.id, {
        allowFailed: true,
        convertRemaining: true,
        actorName,
      });
      if (claimed) return "success";
      // Another path won the claim a moment ago. Its awards may be mid-flight
      // or may have failed; both are idempotent, so make sure.
      await payAwardsFor(p.id);
      return "already";
    }
  }
}

/**
 * Settle any Paystack reference this platform issued, whichever product it
 * paid for. What the webhook and the reconcile cron call.
 */
export async function settlePaystackReference(
  reference: string,
  actorName = "Paystack",
): Promise<SettleResult> {
  switch (referenceKind(reference)) {
    case "subscription":
      return settleSubscriptionPayment(reference, actorName);
    case "wallet":
      return settleTopup("wallet", reference);
    case "sms":
      return settleTopup("sms", reference);
    default:
      return "not-found";
  }
}

export type VoidedPayment = {
  id: string;
  /** Null when the church that paid has since been deleted. */
  churchId: string | null;
  amount: number;
  wasSuccess: boolean;
  /** Months taken back off the renewal date (0 when it was never extended). */
  months: number;
  renewsBefore: Date | null;
  renewsAfter: Date | null;
};

/**
 * Void one payment: mark it "Voided:" and, if it had been honoured, take back
 * the months it added. The database half of the superadmin's Void button,
 * here rather than in the action so it can be raced in a db-check without a
 * signed-in operator (billing-claim.db-check.ts).
 *
 * One transaction, the payment row locked first and the church row second —
 * the same order claimSubscriptionPayment takes them in, so a void and a
 * claim of the same payment queue rather than deadlock, and whichever goes
 * second sees the other's committed result:
 *
 *   - a claim that waited on this void finds "failed" and a Voided note, and
 *     claims nothing (notVoided);
 *   - a void that waited on a claim finds "success", and winds back the months
 *     that claim has just added.
 *
 * The predicate is repeated in the UPDATE and its count checked, so a row
 * that changed under us is reported rather than half-voided.
 */
export async function voidPaymentRecord(
  paymentId: string,
  why: string,
  now: Date = new Date(),
): Promise<{ ok: true; v: VoidedPayment } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({
        id: payment.id,
        churchId: payment.churchId,
        amount: payment.amount,
        status: payment.status,
        note: payment.note,
        periodMonths: payment.periodMonths,
        extendsPlan: payment.extendsPlan,
      })
      .from(payment)
      .where(eq(payment.id, paymentId))
      .for("update")
      .limit(1);
    if (!p) return { ok: false, error: "Payment not found." };
    if (p.status === "failed")
      return {
        ok: false,
        error: p.note?.startsWith("Voided:")
          ? "That payment is already voided."
          : "That payment already failed; there is nothing to void.",
      };

    const done = await tx
      .update(payment)
      .set({ status: "failed", note: `Voided: ${why}` })
      .where(and(eq(payment.id, p.id), inArray(payment.status, ["pending", "success"])))
      .returning({ id: payment.id });
    if (done.length !== 1)
      return {
        ok: false,
        error: "That payment changed while you were voiding it. Reload and try again.",
      };

    const wasSuccess = p.status === "success";
    let renewsBefore: Date | null = null;
    let renewsAfter: Date | null = null;
    // A deleted church has no renewal date left to wind back.
    const churchId = p.churchId;
    if (churchId && wasSuccess && p.extendsPlan && p.periodMonths > 0) {
      const [c] = await tx
        .select({ renewsAt: church.planRenewsAt })
        .from(church)
        .where(eq(church.id, churchId))
        .for("update")
        .limit(1);
      renewsBefore = c?.renewsAt ?? null;
      renewsAfter = rollbackRenewal(renewsBefore, p.periodMonths, now);
      if (renewsAfter)
        await tx
          .update(church)
          .set({ planRenewsAt: renewsAfter })
          .where(eq(church.id, churchId));
    }
    return {
      ok: true,
      v: {
        id: p.id,
        churchId: p.churchId,
        amount: Number(p.amount),
        wasSuccess,
        months: wasSuccess && p.extendsPlan ? p.periodMonths : 0,
        renewsBefore,
        renewsAfter,
      },
    };
  });
}

/**
 * Did the church-to-church referral reward ride on a payment that has just
 * been voided?
 *
 * The reward is paid once, on the church's first payment of real money, as
 * wallet credit to two churches — credit that can already have been spent on
 * SMS. It is NOT clawed back automatically: the amounts were whatever the
 * settings said on the day, and debiting a wallet that has since spent the
 * credit needs a person's judgement, not a rule. So this only answers the
 * question, for the void's audit line, where a human can act on it.
 *
 * True when the church was rewarded and no successful payment of real money
 * is left to have earned it.
 */
export async function referralRestsOnVoid(churchId: string): Promise<{
  orphaned: boolean;
  referrerId: string | null;
}> {
  const [c] = await db
    .select({ referredBy: church.referredByChurchId, rewardedAt: church.referralRewardedAt })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c?.referredBy || !c.rewardedAt) return { orphaned: false, referrerId: null };
  const [other] = await db
    .select({ id: payment.id })
    .from(payment)
    .where(
      and(eq(payment.churchId, churchId), eq(payment.status, "success"), gt(payment.amount, 0)),
    )
    .limit(1);
  return { orphaned: !other, referrerId: c.referredBy };
}
