"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, smsSenderSubmission, walletTxn } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { setSetting, SMS_PRICE_KEY } from "@/lib/platform-settings";
import { sendSms, isSmsConfigured } from "@/lib/sms";
import {
  requestSenderId,
  listNetworkSenderIds,
  lookupSenderId,
  normalizeSenderId,
  type NetworkSenderId,
  type SenderIdStatus,
} from "@/lib/termii-sender";
import { notifyChurchManagers } from "@/lib/notifications";
import { formatMoney } from "@/lib/money";
import { recordAudit } from "@/lib/audit";
import { notifyChurchOfAdminAction } from "@/lib/admin-notify";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** In-app + email — the church must hear about a sender-ID verdict. */
async function notifyApproved(churchId: string, senderId: string | null) {
  await notifyChurchManagers({
    churchId,
    title: "SMS sender ID approved",
    body: `Your SMS sender ID${senderId ? ` “${senderId}”` : ""} was approved — messages to your members will now be sent from it. You can send SMS from Communication.`,
    linkUrl: "/settings/sms",
    email: { subject: "Your SMS sender ID is approved 🎉" },
  });
}

async function notifyRejected(churchId: string, senderId: string | null, reason?: string) {
  await notifyChurchManagers({
    churchId,
    title: "SMS sender ID rejected",
    body: `Your SMS sender ID${senderId ? ` “${senderId}”` : ""} was not approved${reason ? `: ${reason}` : "."} You can request a different one in Settings → SMS.`,
    linkUrl: "/settings/sms",
    email: { subject: "About your SMS sender ID request" },
  });
}

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
    email: { subject: "Your SMS sender ID was revoked" },
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
 * Superadmin sends a reviewed request to the network (Termii).
 *
 * A sender ID must NEVER reach the network twice — Termii keeps one
 * registration per ID per account, and a second request just creates a
 * confusing duplicate row that nobody can clean up. Two things guarantee that:
 *
 *  1. We look the ID up on the network first, and if the lookup FAILS we stop.
 *     ("Couldn't check" is not "isn't registered" — assuming it was is exactly
 *     how the first duplicate got created.)
 *  2. We claim a row in `sms_sender_submission` (unique on the normalized ID)
 *     before calling the network. A double-click, a retry after a timeout, or a
 *     re-application of the same ID hits the unique index and no request is
 *     sent.
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

  const senderId = c.senderId;
  const key = normalizeSenderId(senderId);

  // 1. Ask the network what it already knows. A failure here aborts — we do not
  //    guess, because guessing wrong means a duplicate registration.
  const lookup = await lookupSenderId(senderId);
  if (!lookup.ok)
    return {
      ok: false,
      error: `${lookup.error} Nothing was submitted — try again in a moment.`,
    };

  if (lookup.found) {
    await recordNetworkStatus(key, senderId, churchId, lookup.status, "exists");

    if (lookup.status === "approved") {
      await db
        .update(church)
        .set({ smsSenderStatus: "approved", smsSenderStage: null, smsSenderNote: null })
        .where(eq(church.id, churchId));
      await notifyApproved(churchId, senderId);
      await recordAudit({
        actorUserId: admin.id,
        actorName: admin.name,
        action: "approve_sender_id",
        summary: `Approved "${senderId}" (already approved on the network)`,
        targetType: "church",
        targetId: churchId,
      });
      revalidatePath("/superadmin/sms");
      return {
        ok: true,
        outcome: "approved",
        message: `"${senderId}" is already APPROVED on the network — approved for ${c.name}. The church has been notified.`,
      };
    }
    if (lookup.status === "rejected") {
      return {
        ok: false,
        error: `"${senderId}" is on the network but was rejected/blocked (network says: "${lookup.raw}"). Ask the church to request a different ID.`,
      };
    }
    // Registered and still under review → mark processing, send nothing.
    await markProcessing(churchId, senderId, admin, "already on the network");
    revalidatePath("/superadmin/sms");
    return {
      ok: true,
      outcome: "processing",
      message: `"${senderId}" is already on the network (status: "${lookup.raw}") — marked as processing. Not re-submitted.`,
    };
  }

  // 2. Not on the network. Claim the submission before calling out — whoever
  //    wins the unique index is the only one who may send the request.
  const [claim] = await db
    .insert(smsSenderSubmission)
    .values({
      senderKey: key,
      senderId,
      churchId,
      state: "submitting",
      submittedBy: admin.id,
    })
    .onConflictDoNothing({ target: smsSenderSubmission.senderKey })
    .returning({ id: smsSenderSubmission.id });

  let claimId = claim?.id;
  if (!claimId) {
    // Someone already holds the claim. We may only take it over when the ID
    // definitely never reached the network: a previous attempt that FAILED, or
    // a row we merely believed was registered ("exists") which the network has
    // just told us it doesn't have. A row in "submitted"/"submitting" means the
    // request IS out there — the network's list can lag behind a request by a
    // while — so we send nothing.
    const [retry] = await db
      .update(smsSenderSubmission)
      .set({ state: "submitting", churchId, submittedBy: admin.id, error: null })
      .where(
        and(
          eq(smsSenderSubmission.senderKey, key),
          inArray(smsSenderSubmission.state, ["failed", "exists"]),
        ),
      )
      .returning({ id: smsSenderSubmission.id });

    if (!retry) {
      await markProcessing(churchId, senderId, admin, "already submitted earlier");
      revalidatePath("/superadmin/sms");
      return {
        ok: true,
        outcome: "processing",
        message: `"${senderId}" was already sent to the network earlier — NOT sending it again (the network's list can take a while to show it). It's marked as processing.`,
      };
    }
    claimId = retry.id;
  }

  const reg = await requestSenderId({
    senderId,
    usecase: c.note || "Church service alerts and member updates",
    company: c.name,
  });
  if (!reg.ok) {
    // Release the claim so a later attempt can retry this ID.
    await db
      .update(smsSenderSubmission)
      .set({ state: "failed", error: reg.error.slice(0, 300) })
      .where(eq(smsSenderSubmission.id, claimId));
    return { ok: false, error: reg.error };
  }

  await db
    .update(smsSenderSubmission)
    .set({ state: reg.alreadyExists ? "exists" : "submitted", submittedAt: new Date() })
    .where(eq(smsSenderSubmission.id, claimId));

  await markProcessing(churchId, senderId, admin, "submitted to the network");
  revalidatePath("/superadmin/sms");
  return {
    ok: true,
    outcome: "processing",
    message: `Submitted "${senderId}" to the network — now processing. The church has been notified.`,
  };
}

/** Church sees "Processing"; its managers get told, in-app and by email. */
async function markProcessing(
  churchId: string,
  senderId: string,
  admin: { id: string; name: string },
  how: string,
) {
  await db
    .update(church)
    .set({ smsSenderStage: "submitted" })
    .where(eq(church.id, churchId));
  await notifyChurchManagers({
    churchId,
    title: "SMS sender ID submitted",
    body: `Your SMS sender ID “${senderId}” is now with the network for approval. This usually takes a few working days — we'll let you know as soon as it's approved.`,
    linkUrl: "/settings/sms",
    email: { subject: "Your SMS sender ID is being reviewed" },
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "submit_sender_id",
    summary: `Sender ID "${senderId}" → processing (${how})`,
    targetType: "church",
    targetId: churchId,
  });
}

/** Keep the ledger's view of the network fresh (support/debugging trail). */
async function recordNetworkStatus(
  key: string,
  senderId: string,
  churchId: string,
  status: SenderIdStatus,
  state: "exists" | "submitted",
) {
  await db
    .insert(smsSenderSubmission)
    .values({
      senderKey: key,
      senderId,
      churchId,
      state,
      lastStatus: status,
      lastCheckedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: smsSenderSubmission.senderKey,
      set: { lastStatus: status, lastCheckedAt: new Date() },
    });
}

export type CheckResult =
  | { ok: true; status: SenderIdStatus; raw?: string }
  | { ok: false; error: string };

/**
 * Superadmin: re-check a sender ID against the network now. On a definite
 * verdict we settle the church and notify its team. A network failure is
 * reported as a failure — never as "still processing".
 */
export async function checkSenderIdOnNetwork(churchId: string): Promise<CheckResult> {
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

  const lookup = await lookupSenderId(c.senderId);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  if (!lookup.found)
    return {
      ok: false,
      error: `The network has no record of "${c.senderId}" — it hasn't been submitted yet.`,
    };

  await db
    .update(smsSenderSubmission)
    .set({ lastStatus: lookup.status, lastCheckedAt: new Date() })
    .where(eq(smsSenderSubmission.senderKey, normalizeSenderId(c.senderId)));

  if (lookup.status === "approved") {
    await db
      .update(church)
      .set({ smsSenderStatus: "approved", smsSenderStage: null, smsSenderNote: null })
      .where(eq(church.id, churchId));
    await notifyApproved(churchId, c.senderId);
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "approve_sender_id",
      summary: `"${c.senderId}" approved by the network (checked by admin)`,
      targetType: "church",
      targetId: churchId,
    });
  } else if (lookup.status === "rejected") {
    await db
      .update(church)
      .set({
        smsSenderStatus: "rejected",
        smsSenderStage: null,
        smsSenderNote: "Rejected by the network",
      })
      .where(eq(church.id, churchId));
    await notifyRejected(churchId, c.senderId, "the network declined it");
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "reject_sender_id",
      summary: `"${c.senderId}" rejected by the network (checked by admin)`,
      targetType: "church",
      targetId: churchId,
    });
  }
  revalidatePath("/superadmin/sms");
  return { ok: true, status: lookup.status, raw: lookup.raw };
}

/**
 * Everything registered on our Termii account, as the API reports it. When the
 * app and the Termii dashboard seem to disagree, this is the tie-breaker.
 */
export async function listSenderIdsOnNetwork(): Promise<
  { ok: true; ids: NetworkSenderId[] } | { ok: false; error: string }
> {
  await requireSuperAdmin();
  return await listNetworkSenderIds();
}

/** Manual verdict by a superadmin (e.g. they confirmed it on the Termii dashboard). */
export async function reviewSenderId(
  churchId: string,
  approve: boolean,
  reason?: string,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };
  const [c] = await db
    .select({ senderId: church.smsSenderId })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  await db
    .update(church)
    .set({
      smsSenderStatus: approve ? "approved" : "rejected",
      smsSenderStage: null,
      smsSenderNote: approve ? null : (reason || "").slice(0, 500) || null,
    })
    .where(eq(church.id, churchId));
  if (approve) await notifyApproved(churchId, c?.senderId ?? null);
  else await notifyRejected(churchId, c?.senderId ?? null, reason);
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
  await notifyChurchOfAdminAction({
    churchId,
    title: kind === "credit" ? "Your wallet was credited" : "Your wallet was adjusted",
    subject:
      kind === "credit"
        ? `${formatMoney(amount, c.currency)} added to your FlockInsight wallet`
        : `A deduction from your FlockInsight wallet`,
    body:
      kind === "credit"
        ? "The FlockInsight team added funds to your wallet. You can spend it on SMS and storage add-ons right away."
        : "The FlockInsight team deducted funds from your wallet.",
    details: [
      {
        label: kind === "credit" ? "Amount added" : "Amount deducted",
        value: formatMoney(amount, c.currency),
      },
      { label: "New balance", value: formatMoney(newBalance, c.currency) },
    ],
    note: note?.trim() ? note.trim().slice(0, 200) : null,
    linkUrl: "/settings/wallet",
    ctaLabel: "Open your wallet",
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
