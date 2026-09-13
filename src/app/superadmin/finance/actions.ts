"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { activatePlan } from "@/lib/billing";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { recordAudit } from "@/lib/audit";
import { planName } from "@/lib/plans";
import { trialEndDate } from "@/lib/trial";

export type FinanceResult = { ok: true } | { ok: false; error: string };

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
  months: z.number().int().min(0).max(36).default(1),
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
  const admin = await requireSuperAdmin();
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

  await db.insert(payment).values({
    churchId: d.churchId,
    plan: d.plan,
    amount: d.amount,
    currency: "NGN",
    gateway: d.gateway,
    reference:
      d.reference || `MANUAL-${d.churchId.slice(0, 8)}-${Date.now()}`,
    status: "success",
    periodMonths: d.months || 1,
    note: d.note || `Recorded by ${admin.name ?? "an admin"}`,
    createdBy: admin.id,
    paidAt,
  });

  if (d.months > 0) await activatePlan(d.churchId, d.plan, d.months);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "payment.record",
    summary: `Recorded ₦${d.amount.toLocaleString()} from ${target.name} via ${d.gateway} for ${planName(d.plan)}${d.months ? ` · ${d.months}mo` : ""}`,
    targetType: "church",
    targetId: d.churchId,
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${d.churchId}`);
  return { ok: true };
}

/** Put credit into a church's wallet, or take it back out. */
export async function adjustWallet(input: {
  churchId: string;
  amount: number;
  reason: string;
}): Promise<FinanceResult> {
  const admin = await requireSuperAdmin();
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
      category: "adjustment",
      reason,
      createdBy: admin.id,
    });
    if (!res.ok)
      return {
        ok: false,
        error: `${target.name} only has ₦${res.balance.toLocaleString()} in their wallet.`,
      };
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "wallet.adjust",
    summary: `${amount > 0 ? "Credited" : "Debited"} ₦${Math.abs(amount).toLocaleString()} ${amount > 0 ? "to" : "from"} ${target.name}: ${reason}`,
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
  const admin = await requireSuperAdmin();
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

  // Counted from today, so "4 Sundays" always means four more Sundays from
  // now rather than four from whenever they originally signed up.
  const ends = sundays > 0 ? trialEndDate(new Date(), sundays) : null;

  await db
    .update(church)
    .set({ trialEndsAt: ends, trialReminderStage: 0 })
    .where(eq(church.id, input.churchId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "trial.set",
    summary: ends
      ? `Set ${target.name}'s trial to end ${ends.toDateString()}`
      : `Ended ${target.name}'s trial now`,
    targetType: "church",
    targetId: input.churchId,
  });

  revalidatePath("/superadmin/finance");
  revalidatePath(`/superadmin/churches/${input.churchId}`);
  return { ok: true };
}

/** Mark a payment that never cleared as failed, so it stops counting. */
export async function voidPayment(
  paymentId: string,
  reason: string,
): Promise<FinanceResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(paymentId).success)
    return { ok: false, error: "Invalid id" };
  const why = (reason || "").trim().slice(0, 200);
  if (!why) return { ok: false, error: "Say why this is being voided." };

  const [row] = await db
    .update(payment)
    .set({ status: "failed", note: `Voided: ${why}` })
    .where(eq(payment.id, paymentId))
    .returning({ id: payment.id, churchId: payment.churchId, amount: payment.amount });
  if (!row) return { ok: false, error: "Payment not found." };

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "payment.void",
    summary: `Voided a ₦${Number(row.amount).toLocaleString()} payment: ${why}`,
    targetType: "church",
    targetId: row.churchId,
  });

  revalidatePath("/superadmin/finance");
  return { ok: true };
}
