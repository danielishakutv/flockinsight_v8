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

export type BatchSmsResult =
  | { ok: true; sent: number; failed: number; cost: number; balance: number }
  | { ok: false; error: string };

/**
 * Send (possibly personalised) SMS to many recipients. Groups identical
 * messages into one gateway call, checks the wallet once for the whole batch,
 * deducts the cost of successfully-sent messages and records one ledger entry.
 */
export async function sendChurchSmsBatch(opts: {
  churchId: string;
  recipients: { phone: string; message: string }[];
  userId?: string;
  label?: string;
}): Promise<BatchSmsResult> {
  if (!isSmsConfigured())
    return { ok: false, error: "SMS isn't enabled on the platform yet." };

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
  if (c.status !== "approved" || !c.senderId)
    return {
      ok: false,
      error: "Your SMS sender ID isn't approved yet. Apply in Settings → SMS.",
    };

  // Normalise + drop invalid numbers.
  const valid = opts.recipients
    .map((r) => ({ phone: normalizePhone(r.phone), message: r.message }))
    .filter((r): r is { phone: string; message: string } => !!r.phone);
  if (valid.length === 0)
    return { ok: false, error: "No valid phone numbers to send to." };

  const price = await getSmsPrice();
  const totalCost = +valid
    .reduce((s, r) => s + price * smsPages(r.message), 0)
    .toFixed(2);
  if (c.balance < totalCost)
    return {
      ok: false,
      error: `Not enough SMS balance. This needs ${totalCost.toFixed(2)} but your balance is ${c.balance.toFixed(2)}.`,
    };

  // Group identical messages → one gateway call each.
  const groups = new Map<string, string[]>();
  for (const r of valid) {
    const arr = groups.get(r.message) ?? [];
    arr.push(r.phone);
    groups.set(r.message, arr);
  }

  let sent = 0;
  let failed = 0;
  let spent = 0;
  for (const [message, phones] of groups) {
    const res = await sendSms({ to: phones, message, senderId: c.senderId });
    if (res.ok) {
      sent += phones.length;
      spent += price * smsPages(message) * phones.length;
    } else {
      failed += phones.length;
    }
  }
  spent = +spent.toFixed(2);

  let newBalance = c.balance;
  if (spent > 0) {
    newBalance = +(c.balance - spent).toFixed(2);
    await db.transaction(async (tx) => {
      await tx
        .update(church)
        .set({ smsBalance: newBalance })
        .where(eq(church.id, opts.churchId));
      await tx.insert(smsWalletTxn).values({
        churchId: opts.churchId,
        kind: "debit",
        amount: spent,
        balanceAfter: newBalance,
        reason: opts.label ?? `Bulk SMS to ${sent} recipient(s)`,
        createdBy: opts.userId,
      });
    });
  }

  return { ok: true, sent, failed, cost: spent, balance: newBalance };
}
