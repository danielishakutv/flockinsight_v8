"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsWalletTxn } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { setSetting, SMS_PRICE_KEY } from "@/lib/platform-settings";
import { sendSms, isSmsConfigured } from "@/lib/sms";
import { notifyChurchManagers } from "@/lib/notifications";
import { formatMoney } from "@/lib/money";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Send a test SMS via the platform's default Termii sender ID (TEDxYola). */
export async function sendTestSms(
  to: string,
  message: string,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isSmsConfigured())
    return {
      ok: false,
      error: "Set TERMII_API_KEY and TERMII_SENDER_ID in .env first.",
    };
  const msg = (message || "").trim() || "FlockInsight test SMS — it works!";
  return await sendSms({ to, message: msg });
}

export async function setSmsPrice(price: number): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!Number.isFinite(price) || price < 0 || price > 100000)
    return { ok: false, error: "Invalid price" };
  await setSetting(SMS_PRICE_KEY, String(price));
  revalidatePath("/superadmin/sms");
  return { ok: true };
}

export async function setSenderId(
  churchId: string,
  senderId: string,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  const id = (senderId || "").trim();
  if (!/^[A-Za-z0-9 -]{3,11}$/.test(id))
    return {
      ok: false,
      error: "Sender ID must be 3–11 characters: letters, numbers, spaces or hyphens.",
    };
  await db
    .update(church)
    .set({ smsSenderId: id })
    .where(eq(church.id, churchId));
  revalidatePath("/superadmin/sms");
  return { ok: true };
}

/** Revoke a previously approved sender ID — the church sees it as revoked. */
export async function revokeSenderId(
  churchId: string,
  reason?: string,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  await db
    .update(church)
    .set({
      smsSenderStatus: "revoked",
      smsSenderNote: (reason || "").slice(0, 500) || null,
    })
    .where(eq(church.id, churchId));
  await notifyChurchManagers({
    churchId,
    title: "SMS sender ID revoked",
    body: `Your SMS sender ID was revoked${reason ? `: ${reason}` : "."} You can request a new one in Settings → SMS.`,
    linkUrl: "/settings/sms",
  });
  revalidatePath("/superadmin/sms");
  return { ok: true };
}

export async function reviewSenderId(
  churchId: string,
  approve: boolean,
  reason?: string,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  await db
    .update(church)
    .set({
      smsSenderStatus: approve ? "approved" : "rejected",
      smsSenderNote: approve ? null : (reason || "").slice(0, 500) || null,
    })
    .where(eq(church.id, churchId));
  await notifyChurchManagers({
    churchId,
    title: approve ? "SMS sender ID approved" : "SMS sender ID rejected",
    body: approve
      ? "Your SMS sender ID was approved — you can now send SMS to your members."
      : `Your SMS sender ID application was rejected${reason ? `: ${reason}` : "."} You can apply again in Settings → SMS.`,
    linkUrl: "/settings/sms",
  });
  revalidatePath("/superadmin/sms");
  return { ok: true };
}

export async function adjustWallet(
  churchId: string,
  amount: number,
  kind: "credit" | "debit",
  note?: string,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  if (kind !== "credit" && kind !== "debit")
    return { ok: false, error: "Invalid adjustment" };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000)
    return { ok: false, error: "Enter a positive amount." };

  const [c] = await db
    .select({ balance: church.smsBalance, currency: church.currency })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  if (kind === "debit" && amount > c.balance)
    return {
      ok: false,
      error: `Can't deduct more than the current balance (${c.balance.toFixed(2)}).`,
    };

  const newBalance = +(
    kind === "credit" ? c.balance + amount : c.balance - amount
  ).toFixed(2);

  await db.transaction(async (tx) => {
    await tx
      .update(church)
      .set({ smsBalance: newBalance })
      .where(eq(church.id, churchId));
    await tx.insert(smsWalletTxn).values({
      churchId,
      kind,
      amount,
      balanceAfter: newBalance,
      reason: (
        note || (kind === "credit" ? "Admin top-up" : "Admin deduction")
      ).slice(0, 200),
      createdBy: admin.id,
    });
  });
  await notifyChurchManagers({
    churchId,
    title: kind === "credit" ? "SMS wallet credited" : "SMS wallet adjusted",
    body:
      kind === "credit"
        ? `Your SMS wallet was credited with ${formatMoney(amount, c.currency)}. New balance: ${formatMoney(newBalance, c.currency)}.`
        : `${formatMoney(amount, c.currency)} was deducted from your SMS wallet. New balance: ${formatMoney(newBalance, c.currency)}.`,
    linkUrl: "/settings/sms",
  });
  revalidatePath("/superadmin/sms");
  return { ok: true };
}
