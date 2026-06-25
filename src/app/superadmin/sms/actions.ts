"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsWalletTxn } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { setSetting, SMS_PRICE_KEY } from "@/lib/platform-settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setSmsPrice(price: number): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!Number.isFinite(price) || price < 0 || price > 100000)
    return { ok: false, error: "Invalid price" };
  await setSetting(SMS_PRICE_KEY, String(price));
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
  revalidatePath("/superadmin/sms");
  return { ok: true };
}

export async function topUpSms(
  churchId: string,
  amount: number,
  note?: string,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000)
    return { ok: false, error: "Enter a positive amount." };

  const [c] = await db
    .select({ balance: church.smsBalance })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  const newBalance = +(c.balance + amount).toFixed(2);
  await db.transaction(async (tx) => {
    await tx
      .update(church)
      .set({ smsBalance: newBalance })
      .where(eq(church.id, churchId));
    await tx.insert(smsWalletTxn).values({
      churchId,
      kind: "credit",
      amount,
      balanceAfter: newBalance,
      reason: (note || "Admin top-up").slice(0, 200),
      createdBy: admin.id,
    });
  });
  revalidatePath("/superadmin/sms");
  return { ok: true };
}
