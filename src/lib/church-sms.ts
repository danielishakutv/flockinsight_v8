import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTxn } from "@/db/schema";
import { sendSms, smsPages, normalizePhone, isSmsConfigured } from "@/lib/sms";
import { getSmsPrice } from "@/lib/platform-settings";
import { recordUsage } from "@/lib/usage";

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
      balance: church.walletBalance,
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
      .set({ walletBalance: newBalance })
      .where(eq(church.id, opts.churchId));
    await tx.insert(walletTxn).values({
      churchId: opts.churchId,
      kind: "debit",
      category: "sms",
      amount: cost,
      balanceAfter: newBalance,
      reason: opts.reason ?? `SMS to ${recipients.length} recipient(s)`,
      createdBy: opts.userId,
    });
  });

  await recordUsage("sms", opts.churchId, recipients.length);
  // Pages, not recipients — a 300-character message is 2 pages per recipient,
  // and only the page count reconciles against what Termii charges us.
  await recordUsage(
    "sms_pages",
    opts.churchId,
    smsPages(opts.message) * recipients.length,
  );
  return { ok: true, cost, balance: newBalance };
}

/** What happened to one phone number in a batch. `phone` is the number as it
 *  was given to us, so the caller can match it back to a person. */
export type SmsOutcome = {
  phone: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  /** Termii's id for this message, so a delivery report can be matched to it. */
  providerMessageId?: string | null;
};

export type BatchSmsResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      /** Numbers we never attempted because they weren't usable. */
      skipped: number;
      cost: number;
      balance: number;
      outcomes: SmsOutcome[];
    }
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
      balance: church.walletBalance,
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

  // Normalise. An unusable number is reported back as "skipped" rather than
  // silently dropped — otherwise a send to 120 quietly becomes a send to 116
  // and nobody can tell which four were left out.
  const outcomes: SmsOutcome[] = [];
  const valid: { phone: string; original: string; message: string }[] = [];
  for (const r of opts.recipients) {
    const phone = normalizePhone(r.phone);
    if (!phone) {
      outcomes.push({
        phone: r.phone,
        status: "skipped",
        error: "Not a usable phone number",
      });
      continue;
    }
    valid.push({ phone, original: r.phone, message: r.message });
  }
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
  const groups = new Map<string, { phone: string; original: string }[]>();
  for (const r of valid) {
    const arr = groups.get(r.message) ?? [];
    arr.push({ phone: r.phone, original: r.original });
    groups.set(r.message, arr);
  }

  let sent = 0;
  let failed = 0;
  let spent = 0;
  let pagesSent = 0;
  for (const [message, people] of groups) {
    const res = await sendSms({
      to: people.map((p) => p.phone),
      message,
      senderId: c.senderId,
    });
    if (res.ok) {
      sent += people.length;
      spent += price * smsPages(message) * people.length;
      pagesSent += smsPages(message) * people.length;
      // One call covers the whole group, so the gateway's verdict applies to
      // every number in it. Termii returns its ids in the same order we sent
      // the numbers — an assumption, so a missing id is left null and the
      // delivery webhook falls back to matching on the phone number.
      for (const [i, p] of people.entries())
        outcomes.push({
          phone: p.original,
          status: "sent",
          providerMessageId: res.ids[i] ?? null,
        });
    } else {
      failed += people.length;
      for (const p of people)
        outcomes.push({ phone: p.original, status: "failed", error: res.error });
    }
  }
  spent = +spent.toFixed(2);

  let newBalance = c.balance;
  if (spent > 0) {
    newBalance = +(c.balance - spent).toFixed(2);
    await db.transaction(async (tx) => {
      await tx
        .update(church)
        .set({ walletBalance: newBalance })
        .where(eq(church.id, opts.churchId));
      await tx.insert(walletTxn).values({
        churchId: opts.churchId,
        kind: "debit",
        category: "sms",
        amount: spent,
        balanceAfter: newBalance,
        reason: opts.label ?? `Bulk SMS to ${sent} recipient(s)`,
        createdBy: opts.userId,
      });
    });
  }

  if (sent > 0) await recordUsage("sms", opts.churchId, sent);
  if (pagesSent > 0) await recordUsage("sms_pages", opts.churchId, pagesSent);
  return {
    ok: true,
    sent,
    failed,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    cost: spent,
    balance: newBalance,
    outcomes,
  };
}
