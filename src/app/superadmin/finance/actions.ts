"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";

import {
  activatePlan,
  claimSubscriptionPayment,
  referralRestsOnVoid,
  settleSubscriptionPayment,
  voidPaymentRecord,
} from "@/lib/billing";
import { awardPartnerCommission, reversePartnerCommission } from "@/lib/partners";
import { awardReferralIfDue } from "@/lib/referrals";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { recordAudit } from "@/lib/audit";
import { planName } from "@/lib/plans";
import { trialEndDate } from "@/lib/trial";
import { referenceKind } from "@/lib/paystack-outcome";
import { isPaystackConfigured } from "@/lib/paystack";

import { requirePlatform } from "@/lib/platform-access";
/**
 * `warning` is a success with something a person still has to do — a void
 * that stood but left a referral reward in two wallets. Not an error: the
 * action did what was asked, and a red toast would say it had not.
 */
export type FinanceResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

const PLANS = ["starter", "growth", "pro", "enterprise"] as const;

/**
 * Record money that arrived outside a payment gateway.
 *
 * Most churches here pay by bank transfer, and until now the only way to
 * reflect that was "set the plan", which wrote a payment row with an amount of
 * zero. The plan changed and the revenue did not — so every month-end total
 * was short by exactly the transfers, which are most of them.
 *
 * This takes the real figure.
 */
const recordSchema = z.object({
  churchId: z.string().min(1),
  amount: z.number().positive("Enter the amount received").max(100_000_000),
  plan: z.enum(PLANS),
  /*
   * How much subscription this money pays for — which is what the Partner's
   * commission is priced across. Never 0: "0 months" used to be how an admin
   * said "don't touch the plan", and the row was then stored as ONE month, so
   * a ₦100,000 annual transfer earned commission as if it were a single
   * ₦100,000 month. Whether the plan moves is `extendPlan`, a separate
   * question with its own answer.
   */
  months: z
    .number()
    .int()
    .min(1, "Enter the months this payment covers")
    .max(36)
    .default(1),
  /** Also move the renewal date by `months`. Off when the plan was set by hand already. */
  extendPlan: z.boolean().default(true),
  gateway: z.enum(["transfer", "cash", "pos", "paystack", "flutterwave", "other"]),
  reference: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(200).optional().default(""),
  /** Date the money actually landed, not the date it was typed in. */
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
});

export async function recordOfflinePayment(
  input: z.input<typeof recordSchema>,
): Promise<FinanceResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const [target] = await db
    .select({ name: church.name })
    .from(church)
    .where(eq(church.id, d.churchId))
    .limit(1);
  if (!target) return { ok: false, error: "Church not found." };

  /*
   * Build the paid date at midday.
   *
   * A date built at local midnight can land on the previous day once it is
   * stored as UTC, which quietly moves a payment into the wrong month and
   * makes two month-end totals wrong at once.
   */
  const paidAt = d.paidOn
    ? new Date(
        Number(d.paidOn.slice(0, 4)),
        Number(d.paidOn.slice(5, 7)) - 1,
        Number(d.paidOn.slice(8, 10)),
        12,
      )
    : new Date();

  /*
   * The row and the plan extension in one transaction: a payment recorded
   * without its months (or months without the payment) is a ledger that
   * cannot explain itself — and a void reads `extendsPlan` to undo exactly
   * what this did, and nothing it did not.
   */
  let recorded: { id: string; renewsAt: Date | null };
  try {
    recorded = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payment)
        .values({
          churchId: d.churchId,
          plan: d.plan,
          amount: d.amount,
          currency: "NGN",
          gateway: d.gateway,
          reference:
            d.reference || `MANUAL-${d.churchId.slice(0, 8)}-${Date.now()}`,
          status: "success",
          periodMonths: d.months,
          extendsPlan: d.extendPlan,
          note: d.note || `Recorded by ${admin.name ?? "an admin"}`,
          createdBy: admin.id,
          paidAt,
        })
        .returning({ id: payment.id });
      // An operator who types "12 months of Pro" means exactly that: no
      // revaluation of what was left (see ActivateOptions.convertRemaining).
      const renewsAt = d.extendPlan
        ? await activatePlan(d.churchId, d.plan, d.months, { tx })
        : null;
      return { id: row.id, renewsAt };
    });
  } catch (e) {
    console.error(`[finance] could not record a payment for ${d.churchId}`, e);
    return {
      ok: false,
      error: d.reference
        ? "Could not record that payment — is that reference already recorded?"
        : "Could not record that payment. Nothing was saved — please try again.",
    };
  }

  /*
   * The Partner's commission, on money that never went near a gateway.
   *
   * Most churches here pay by bank transfer, and a church paying for a YEAR
   * almost always does — so this is the path an annual payment actually takes.
   * Without this line the Partner who closed it earned nothing at all, and the
   * only payments that ever paid a commission were the card ones. Idempotent
   * and it never throws, exactly as in the gateway callback: a commission that
   * failed to record must not fail the recording of money that has arrived.
   */
  await awardPartnerCommission(recorded.id);
  /*
   * And the church-to-church referral, which until now was paid on card
   * payments only — never on the transfers most churches actually make.
   * Idempotent and never throws, like the commission. Real money only: the
   * schema already refuses a ₦0 amount, and the guard says why.
   */
  if (d.amount > 0) await awardReferralIfDue(d.churchId);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "payment.record",
    summary: `Recorded ₦${d.amount.toLocaleString()} from ${target.name} via ${d.gateway} for ${planName(d.plan)} · ${d.months}mo${
      d.extendPlan
        ? recorded.renewsAt
          ? ` — paid through ${recorded.renewsAt.toDateString()}`
          : ""
        : " (plan not extended)"
    }`,
    targetType: "church",
    targetId: d.churchId,
    meta: {
      paymentId: recorded.id,
      months: d.months,
      extendPlan: d.extendPlan,
      renewsAt: recorded.renewsAt?.toISOString() ?? null,
    },
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${d.churchId}`);
  return { ok: true };
}

/**
 * Put credit into a church's wallet, or take it back out.
 *
 * With `asAdvance`, a debit may take the balance below zero — the church then
 * owes that amount, and their next top-up settles it automatically, because a
 * credit is simply added to whatever the balance is. That is the whole
 * mechanism: no separate loan ledger, no reconciliation step.
 *
 * Only ever from here. Nothing a church can trigger itself may go negative, or
 * a credit line becomes an accident anyone can have.
 */
export async function adjustWallet(input: {
  churchId: string;
  amount: number;
  reason: string;
  asAdvance?: boolean;
}): Promise<FinanceResult> {
  const admin = await requirePlatform("platform.finance.manage");
  if (!z.string().min(1).safeParse(input.churchId).success)
    return { ok: false, error: "Invalid id" };
  const amount = Math.round(Number(input.amount) || 0);
  if (amount === 0) return { ok: false, error: "Enter an amount." };
  if (Math.abs(amount) > 10_000_000)
    return { ok: false, error: "That is larger than this tool allows." };
  const reason = (input.reason || "").trim().slice(0, 200);
  if (!reason) return { ok: false, error: "Say why — it shows on their statement." };

  const [target] = await db
    .select({ name: church.name })
    .from(church)
    .where(eq(church.id, input.churchId))
    .limit(1);
  if (!target) return { ok: false, error: "Church not found." };

  /*
   * Credit and debit are separate calls, and debit can refuse.
   *
   * creditWallet clamps its amount to zero or more, so handing it a negative
   * number does nothing at all and reports success — the adjustment would
   * appear to work and change nothing. Taking money out has to go through
   * debitWallet, which checks there is enough there first.
   */
  if (amount > 0) {
    await creditWallet({
      churchId: input.churchId,
      amount,
      category: "adjustment",
      reason,
      createdBy: admin.id,
    });
  } else {
    const res = await debitWallet({
      churchId: input.churchId,
      amount: Math.abs(amount),
      category: input.asAdvance ? "advance" : "adjustment",
      reason,
      createdBy: admin.id,
      allowNegative: input.asAdvance === true,
    });
    if (!res.ok)
      return {
        ok: false,
        error: `${target.name} only has ₦${res.balance.toLocaleString()}. Tick "advance" to let it go below zero.`,
      };
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "wallet.adjust",
    summary: `${amount > 0 ? "Credited" : input.asAdvance ? "Advanced against" : "Debited"} ₦${Math.abs(amount).toLocaleString()} ${amount > 0 ? "to" : "from"} ${target.name}: ${reason}`,
    targetType: "church",
    targetId: input.churchId,
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${input.churchId}`);
  return { ok: true };
}

/**
 * Move a church's trial end date.
 *
 * Extending is the common case — a church that lost a month to a broken phone,
 * or one being given a little longer to decide. Ending it on the spot is the
 * other: it turns the paywall on immediately.
 */
export async function setTrial(input: {
  churchId: string;
  sundays: number;
}): Promise<FinanceResult> {
  const admin = await requirePlatform("platform.finance.manage");
  if (!z.string().min(1).safeParse(input.churchId).success)
    return { ok: false, error: "Invalid id" };
  const sundays = Math.round(Number(input.sundays) || 0);
  if (sundays < 0 || sundays > 52)
    return { ok: false, error: "Choose between 0 and 52 Sundays." };

  const [target] = await db
    .select({ name: church.name })
    .from(church)
    .where(eq(church.id, input.churchId))
    .limit(1);
  if (!target) return { ok: false, error: "Church not found." };

  /*
   * Counted from today, so "4 Sundays" always means four more Sundays from
   * now rather than four from whenever they originally signed up.
   *
   * Zero is a trial that ended a second ago — NOT null. Null is how a
   * grandfathered church with no trial looks, and computeStanding never gates
   * one, so "end the trial now and turn the paywall on" turned it off for
   * good. The reminder cron only looks at trials still ahead, so a date in the
   * past sends nobody an email.
   */
  const now = new Date();
  const ends = sundays > 0 ? trialEndDate(now, sundays) : new Date(now.getTime() - 1000);

  await db
    .update(church)
    .set({ trialEndsAt: ends, trialReminderStage: 0 })
    .where(eq(church.id, input.churchId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "trial.set",
    summary:
      sundays > 0
        ? `Set ${target.name}'s trial to end ${ends.toDateString()}`
        : `Ended ${target.name}'s trial now — paywall on unless they have a paid plan or a waiver`,
    targetType: "church",
    targetId: input.churchId,
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${input.churchId}`);
  return { ok: true };
}

/**
 * Confirm a payment the gateway left hanging.
 *
 * A payment stuck on pending is money we may well have received while the
 * callback never arrived — it counts nowhere until somebody says it landed.
 * Voiding it would be wrong; this is the other half of that pair.
 *
 * It goes through the same claim as the callback, the webhook and the
 * reconcile cron (lib/billing.ts), so it can never extend a plan a second
 * time for a payment one of them honoured a moment earlier, and the referral
 * reward and the commission follow it the same way.
 *
 * A Paystack checkout is ASKED about first. "Confirm" on a checkout Paystack
 * says was abandoned is not a confirmation, it is a free plan — so that is
 * refused, with the way to record money that really did arrive another way.
 */
export async function markPaymentReceived(
  paymentId: string,
): Promise<FinanceResult> {
  const admin = await requirePlatform("platform.finance.manage");
  if (!z.string().uuid().safeParse(paymentId).success)
    return { ok: false, error: "Invalid id" };

  const [p] = await db
    .select({
      id: payment.id,
      churchId: payment.churchId,
      amount: payment.amount,
      status: payment.status,
      gateway: payment.gateway,
      reference: payment.reference,
      note: payment.note,
    })
    .from(payment)
    .where(eq(payment.id, paymentId))
    .limit(1);
  if (!p) return { ok: false, error: "Payment not found." };
  if (p.status === "success") return { ok: false, error: "That payment is already confirmed." };
  if (p.note?.startsWith("Voided:"))
    return {
      ok: false,
      error: "That payment was voided. If the money did arrive, record it with Record payment.",
    };

  const actorName = `${admin.name ?? "An admin"} (finance)`;
  if (p.gateway === "paystack" && referenceKind(p.reference) === "subscription") {
    /*
     * Without a key there is nobody to ask, and "couldn't reach Paystack, try
     * again" would be a promise that can never come true: the row could not
     * be confirmed this way on this server at all.
     */
    if (!isPaystackConfigured())
      return {
        ok: false,
        error:
          "Payments are not configured on this server, so Paystack cannot be asked about this checkout. If the money arrived, record it with Record payment and void this one.",
      };
    const result = await settleSubscriptionPayment(p.reference, actorName);
    switch (result) {
      case "success":
        break;
      case "already":
        // The webhook, the callback or the cron honoured it between this
        // admin's click and the verify. Not their confirmation, so no audit
        // line in their name — the payment's own line already says who.
        revalidatePath("/superadmin/finance");
        return {
          ok: false,
          error: "Paystack confirmed that payment a moment ago — there is nothing more to do.",
        };
      case "pending":
        return {
          ok: false,
          error: "Paystack says this payment is still in progress. It will confirm itself when it completes.",
        };
      case "failed":
        return {
          ok: false,
          error:
            "Paystack says this checkout was never paid. If the church paid you another way, record it with Record payment and void this one.",
        };
      case "mismatch":
        return {
          ok: false,
          error:
            "Paystack reports a different amount or currency from what was charged. Check it in the Paystack dashboard; it has not been honoured.",
        };
      case "unknown":
        return { ok: false, error: "Couldn't reach Paystack to check. Try again in a minute." };
      case "not-found":
        return { ok: false, error: "Payment not found." };
    }
  } else {
    const claimed = await claimSubscriptionPayment(p.id, {
      allowFailed: true,
      convertRemaining: true,
      actorName,
    });
    if (!claimed) return { ok: false, error: "That payment is no longer pending." };
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "payment.confirm",
    summary: `Confirmed a ₦${Number(p.amount).toLocaleString()} payment the gateway left pending`,
    targetType: "church",
    targetId: p.churchId,
    meta: { paymentId: p.id, reference: p.reference },
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${p.churchId}`);
  return { ok: true };
}

/**
 * Void a payment: one that never cleared, or one that did and is being
 * reversed (a bounced transfer, a refund, a mistyped amount).
 *
 * Voiding a SUCCESS used to change the status and nothing else. The church
 * kept the months the money had bought, and the Partner kept a commission
 * they could withdraw on money that never arrived — and because the next
 * payment no longer counted this one, it earned the "first payment"
 * commission all over again. So a void now undoes what the payment did:
 *
 *   - the renewal date moves back by the months this payment added, never to
 *     before now (rollbackRenewal explains why that is also what keeps the
 *     time OTHER payments bought), and only if this payment moved it at all;
 *   - the Partner's commission on it is reversed (lib/partners.ts);
 *   - all of it in the audit line, with the dates before and after.
 *
 * The status change and the plan rollback are one transaction, with the
 * payment row and the church row locked, so a callback or a confirm racing
 * this void cannot re-honour the row or extend from the date being wound
 * back. The row stays, marked "Voided:", which every claim path refuses.
 */
export async function voidPayment(
  paymentId: string,
  reason: string,
): Promise<FinanceResult> {
  const admin = await requirePlatform("platform.finance.manage");
  if (!z.string().uuid().safeParse(paymentId).success)
    return { ok: false, error: "Invalid id" };
  const why = (reason || "").trim().slice(0, 200);
  if (!why) return { ok: false, error: "Say why this is being voided." };

  const outcome = await voidPaymentRecord(paymentId, why);
  if (!outcome.ok) return outcome;
  const v = outcome.v;

  /*
   * After the commit: the void stands whether or not this works, and a
   * commission reversal that failed must be SEEN, not swallowed — it is money
   * a Partner could still withdraw.
   */
  let commissionError: string | null = null;
  if (v.wasSuccess) {
    try {
      await reversePartnerCommission(v.id);
    } catch (e) {
      console.error(`[finance] void ${v.id}: could not reverse the Partner commission`, e);
      commissionError = e instanceof Error ? e.message : String(e);
    }
  }

  /*
   * The church-to-church referral reward is NOT clawed back by itself (see
   * referralRestsOnVoid): it is wallet credit two churches may already have
   * spent. If this was the payment that earned it, the audit line says so in
   * words, so the operator can adjust the wallets by hand.
   */
  const referral = v.wasSuccess && v.amount > 0 && v.churchId
    ? await referralRestsOnVoid(v.churchId)
    : { orphaned: false, referrerId: null };

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "payment.void",
    summary: `Voided a ₦${v.amount.toLocaleString()} ${v.wasSuccess ? "successful" : "pending"} payment: ${why}${
      v.renewsAfter
        ? ` — plan wound back ${v.months} month${v.months === 1 ? "" : "s"}, now paid through ${v.renewsAfter.toDateString()}`
        : ""
    }${v.wasSuccess ? (commissionError ? " — Partner commission NOT reversed" : " — Partner commission reversed") : ""}${
      referral.orphaned
        ? " — the referral reward this payment earned (wallet credit to this church and its referrer) was NOT reversed; adjust both wallets by hand if it should be"
        : ""
    }`,
    targetType: "church",
    targetId: v.churchId,
    meta: {
      paymentId: v.id,
      wasSuccess: v.wasSuccess,
      monthsRolledBack: v.months,
      renewsBefore: v.renewsBefore?.toISOString() ?? null,
      renewsAfter: v.renewsAfter?.toISOString() ?? null,
      commissionError,
      referralRewardUnreversed: referral.orphaned,
      referrerChurchId: referral.orphaned ? referral.referrerId : null,
    },
    severity: v.wasSuccess ? "critical" : "notice",
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${v.churchId}`);
  revalidatePath("/superadmin/partners");
  if (commissionError)
    return {
      ok: false,
      error: `Voided, and the plan was wound back — but the Partner's commission on it could not be reversed (${commissionError}). Reverse it from Partners before their next withdrawal.`,
    };
  if (referral.orphaned)
    return {
      ok: true,
      warning:
        "Voided. This was the payment that earned the church's referral reward, and that wallet credit (to this church and the church that referred it) has not been taken back. Adjust both wallets by hand if it should be.",
    };
  return { ok: true };
}
