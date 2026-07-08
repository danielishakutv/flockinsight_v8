"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTxn } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { setSetting, SMS_PRICE_KEY } from "@/lib/platform-settings";
import { sendSms, isSmsConfigured } from "@/lib/sms";
import {
  requestSenderId,
  fetchSenderIdInfo,
  fetchSenderIdStatus,
  type SenderIdStatus,
} from "@/lib/termii-sender";
import { notifyChurchManagers } from "@/lib/notifications";
import { formatMoney } from "@/lib/money";
import { recordAudit } from "@/lib/audit";

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
  const admin = await requireSuperAdmin();
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
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "revoke_sender_id",
    summary: `Revoked a church's SMS sender ID${reason ? `: ${reason}` : ""}`,
    targetType: "church",
    targetId: churchId,
  });
  revalidatePath("/superadmin/sms");
  return { ok: true };
}

export type SubmitSenderResult =
  | { ok: true; outcome: "approved" | "processing"; message: string }
  | { ok: false; error: string };

/**
 * Superadmin sends a reviewed request to the network (Termii). Checks the
 * network FIRST — a church that requested before this review step existed may
 * already be on Termii. If it's already approved there, we approve it for the
 * church; if already pending, we just mark it processing (no duplicate submit);
 * otherwise we submit a fresh request. The church then sees "Processing" until
 * it's finally approved.
 */
export async function submitSenderIdToTermii(
  churchId: string,
): Promise<SubmitSenderResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };

  const [c] = await db
    .select({
      name: church.name,
      senderId: church.smsSenderId,
      note: church.smsSenderNote,
      status: church.smsSenderStatus,
    })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c || !c.senderId)
    return { ok: false, error: "This church hasn't requested a sender ID yet." };
  if (c.status !== "pending")
    return { ok: false, error: "This request isn't pending review." };

  // Look it up on the network first, so we never submit a duplicate.
  const info = await fetchSenderIdInfo(c.senderId);
  if (info.found) {
    if (info.status === "approved") {
      await db
        .update(church)
        .set({ smsSenderStatus: "approved", smsSenderStage: null, smsSenderNote: null })
        .where(eq(church.id, churchId));
      await notifyChurchManagers({
        churchId,
        title: "SMS sender ID approved",
        body: "Your SMS sender ID was approved — you can now send SMS to your members.",
        linkUrl: "/settings/sms",
      });
      await recordAudit({
        actorUserId: admin.id,
        actorName: admin.name,
        action: "approve_sender_id",
        summary: `Approved "${c.senderId}" (already approved on the network)`,
        targetType: "church",
        targetId: churchId,
      });
      revalidatePath("/superadmin/sms");
      return {
        ok: true,
        outcome: "approved",
        message: `"${c.senderId}" already exists on the network and is APPROVED — approved for ${c.name}.`,
      };
    }
    if (info.status === "rejected") {
      return {
        ok: false,
        error: `"${c.senderId}" exists on the network but was rejected/blocked. Ask the church to request a different ID.`,
      };
    }
    // Already on the network and pending → mark processing, don't re-submit.
    await db
      .update(church)
      .set({ smsSenderStage: "submitted" })
      .where(eq(church.id, churchId));
    await notifyChurchManagers({
      churchId,
      title: "SMS sender ID submitted",
      body: "Your SMS sender ID is now processing with the network. We'll let you know once it's approved.",
      linkUrl: "/settings/sms",
    });
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "submit_sender_id",
      summary: `Marked "${c.senderId}" as processing (already on the network)`,
      targetType: "church",
      targetId: churchId,
    });
    revalidatePath("/superadmin/sms");
    return {
      ok: true,
      outcome: "processing",
      message: `"${c.senderId}" already exists on the network — marked as processing.`,
    };
  }

  // Not on the network → submit a fresh request.
  const reg = await requestSenderId({
    senderId: c.senderId,
    usecase: c.note || "Church service alerts and member updates",
    company: c.name,
  });
  if (!reg.ok) return { ok: false, error: reg.error };

  await db
    .update(church)
    .set({ smsSenderStage: "submitted" })
    .where(eq(church.id, churchId));
  await notifyChurchManagers({
    churchId,
    title: "SMS sender ID submitted",
    body: "Your SMS sender ID has been submitted to the network and is now processing. We'll let you know once it's approved.",
    linkUrl: "/settings/sms",
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "submit_sender_id",
    summary: `Submitted a church's SMS sender ID "${c.senderId}" to the network`,
    targetType: "church",
    targetId: churchId,
  });
  revalidatePath("/superadmin/sms");
  return {
    ok: true,
    outcome: "processing",
    message: `Submitted "${c.senderId}" to the network — now processing.`,
  };
}

/**
 * Superadmin: re-check a processing sender ID against the network now. If the
 * network has approved/rejected it, we update the church and notify its team.
 */
export async function checkSenderIdOnNetwork(
  churchId: string,
): Promise<{ ok: true; status: SenderIdStatus } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };

  const [c] = await db
    .select({ senderId: church.smsSenderId })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c || !c.senderId)
    return { ok: false, error: "This church hasn't requested a sender ID yet." };

  const status = await fetchSenderIdStatus(c.senderId);
  if (status === "approved") {
    await db
      .update(church)
      .set({ smsSenderStatus: "approved", smsSenderStage: null, smsSenderNote: null })
      .where(eq(church.id, churchId));
    await notifyChurchManagers({
      churchId,
      title: "SMS sender ID approved",
      body: "Your SMS sender ID was approved — you can now send SMS to your members.",
      linkUrl: "/settings/sms",
    });
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "approve_sender_id",
      summary: `"${c.senderId}" approved by the network (checked by admin)`,
      targetType: "church",
      targetId: churchId,
    });
  } else if (status === "rejected") {
    await db
      .update(church)
      .set({
        smsSenderStatus: "rejected",
        smsSenderStage: null,
        smsSenderNote: "Rejected by the network",
      })
      .where(eq(church.id, churchId));
    await notifyChurchManagers({
      churchId,
      title: "SMS sender ID rejected",
      body: "Your SMS sender ID was rejected by the network. You can request a different one in Settings → SMS.",
      linkUrl: "/settings/sms",
    });
  }
  revalidatePath("/superadmin/sms");
  return { ok: true, status };
}

export async function reviewSenderId(
  churchId: string,
  approve: boolean,
  reason?: string,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  await db
    .update(church)
    .set({
      smsSenderStatus: approve ? "approved" : "rejected",
      smsSenderStage: null,
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
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: approve ? "approve_sender_id" : "reject_sender_id",
    summary: `${approve ? "Approved" : "Rejected"} a church's SMS sender ID`,
    targetType: "church",
    targetId: churchId,
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
    .select({ balance: church.walletBalance, currency: church.currency })
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
      .set({ walletBalance: newBalance })
      .where(eq(church.id, churchId));
    await tx.insert(walletTxn).values({
      churchId,
      kind,
      category: "adjustment",
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
    title: kind === "credit" ? "Wallet credited" : "Wallet adjusted",
    body:
      kind === "credit"
        ? `Your wallet was credited with ${formatMoney(amount, c.currency)}. New balance: ${formatMoney(newBalance, c.currency)}.`
        : `${formatMoney(amount, c.currency)} was deducted from your wallet. New balance: ${formatMoney(newBalance, c.currency)}.`,
    linkUrl: "/settings/wallet",
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: kind === "credit" ? "credit_wallet" : "debit_wallet",
    summary: `${kind === "credit" ? "Credited" : "Deducted"} ${formatMoney(amount, c.currency)} ${kind === "credit" ? "to" : "from"} a church's SMS wallet`,
    targetType: "church",
    targetId: churchId,
  });
  revalidatePath("/superadmin/sms");
  return { ok: true };
}
