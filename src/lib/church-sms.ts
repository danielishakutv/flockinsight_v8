import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsWalletTxn } from "@/db/schema";
import { sendSms, smsPages, normalizePhone, isSmsConfigured } from "@/lib/sms";
import { getSmsPrice } from "@/lib/platform-settings";

export type ChurchSmsResult =
  | { ok: true; cost: number; balance: number }
  | { ok: false; error: string };

/**
 * Send SMS on behalf of a church: requires an approved sender ID and enough
 * wallet balance. Deducts cost (price × pages × recipients) and records a
 * ledger entry. Used by follow-up and any future broadcast features.
 */
export async function sendChurchSms(opts: {
  churchId: string;
  to: string | string[];
  message: string;
  userId?: string;
  reason?: string;
}): Promise<ChurchSmsResult> {
  if (!isSmsConfigured()) {
    return { ok: false, error: "SMS isn't enabled on the platform yet." };
  }

  const [c] = await db
    .select({
      senderId: church.smsSenderId,
      status: church.smsSenderStatus,
      balance: church.smsBalance,
    })
    .from(church)
    .where(eq(church.id, opts.churchId))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };
  if (c.status !== "approved" || !c.senderId) {
    return {
      ok: false,
      error: "Your SMS sender ID isn't approved yet. Apply in Settings → SMS.",
    };
  }

  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map(normalizePhone)
    .filter((n): n is string => !!n);
  if (recipients.length === 0)
    return { ok: false, error: "No valid phone number to send to." };

  const price = await getSmsPrice();
  const cost = +(price * smsPages(opts.message) * recipients.length).toFixed(2);
  if (c.balance < cost) {
    return {
      ok: false,
      error: `Not enough SMS balance. This needs ${cost.toFixed(2)} but your balance is ${c.balance.toFixed(2)}.`,
    };
  }

  const result = await sendSms({
    to: recipients,
    message: opts.message,
    senderId: c.senderId,
  });
  if (!result.ok) return result;

  // Deduct and record the ledger entry.
  const newBalance = +(c.balance - cost).toFixed(2);
  await db.transaction(async (tx) => {
    await tx
      .update(church)
      .set({ smsBalance: newBalance })
      .where(eq(church.id, opts.churchId));
    await tx.insert(smsWalletTxn).values({
      churchId: opts.churchId,
      kind: "debit",
      amount: cost,
      balanceAfter: newBalance,
      reason: opts.reason ?? `SMS to ${recipients.length} recipient(s)`,
      createdBy: opts.userId,
    });
  });

  return { ok: true, cost, balance: newBalance };
}
