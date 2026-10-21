"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, smsTopup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import { isSmsConfigured } from "@/lib/sms";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { notifySuperAdminsByEmail } from "@/lib/notifications";
import {
  lookupSenderId,
  normalizeSenderId,
  type SenderIdStatus,
} from "@/lib/termii-sender";
import { whoOwns } from "@/lib/sender-id-reconcile";
import { platformSenderId } from "@/lib/sms-sender";
import { rateLimit } from "@/lib/rate-limit";
import { escapeHtml } from "@/lib/html-escape";
import { topupAmountProblem } from "@/lib/paystack-outcome";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type ApplyResult =
  | { ok: true; outcome: "approved" | "pending" | "requested" }
  | { ok: false; error: string };

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export type TopupResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function startSmsTopup(amount: number): Promise<TopupResult> {
  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  // The same rule as the wallet top-up, kobo included: an amount Paystack and
  // the row round differently is charged and never credited.
  const problem = topupAmountProblem(amount);
  if (problem) return { ok: false, error: problem };
  if (!isPaystackConfigured())
    return { ok: false, error: "Online payment isn't set up yet. Contact us." };

  const reference = `SMS-${c.id.slice(0, 8)}-${Date.now()}`;

  // Paystack first, then the row — see the same note in settings/wallet/actions.ts.
  // An insert before the call left a `pending` top-up behind whenever Paystack
  // could not be reached, for money nobody was ever asked for.
  const init = await paystackInit({
    email: user.email,
    amountNaira: amount,
    reference,
    callbackUrl: `${BASE_URL}/settings/sms/callback`,
    metadata: { kind: "sms_topup", churchId: c.id, amount },
  });
  if (!init.ok) return init;

  // If this write fails, do not hand back the checkout url: the callback finds
  // the payment by looking this reference up, so a checkout with no row would
  // take the money and fail to credit the balance.
  try {
    await db
      .insert(smsTopup)
      .values({ churchId: c.id, amount, reference, createdBy: user.id });
  } catch (e) {
    console.error(`sms topup: could not record ${reference}`, e);
    return {
      ok: false,
      error: "We couldn't start that top-up. Nothing was charged — please try again.",
    };
  }

  await audit({
    churchId: c.id,
    action: "billing.sms_topup.create",
    summary: `Started an SMS top-up of ₦${amount.toLocaleString()}`,
    targetType: "sms-topup",
    targetLabel: reference,
    meta: { amount, reference },
    severity: "notice",
  });

  return { ok: true, url: init.url };
}

export async function applySenderId(
  senderId: string,
  note: string,
): Promise<ApplyResult> {
  const id = (senderId || "").trim();
  if (!/^[A-Za-z0-9 -]{3,11}$/.test(id))
    return {
      ok: false,
      error: "Sender ID must be 3–11 characters: letters, numbers, spaces or hyphens.",
    };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  if (!isSmsConfigured())
    return { ok: false, error: "SMS isn't enabled on the platform yet." };
  if (!smsAvailableForCountry(c.country))
    return {
      ok: false,
      error: "SMS isn't available in your country yet — it's coming soon.",
    };

  const cleanNote = (note || "").trim().slice(0, 500) || null;
  const same = normalizeSenderId(c.smsSenderId ?? "") === normalizeSenderId(id);

  // Re-applying for the ID you already have changes nothing — and must NOT send
  // it back to "awaiting review", or a superadmin would submit it to the
  // network a second time.
  if (same && c.smsSenderStatus === "approved")
    return { ok: true, outcome: "approved" };
  if (same && c.smsSenderStatus === "pending") {
    if (cleanNote && cleanNote !== c.smsSenderNote)
      await db
        .update(church)
        .set({ smsSenderNote: cleanNote })
        .where(eq(church.id, c.id));
    revalidatePath("/settings/sms");
    return { ok: true, outcome: "pending" };
  }

  /*
   * FlockInsight's own sender ID is the name the platform's messages arrive
   * under. It is approved on the same network account, so a church that asked
   * for it would be "approved" the first time it pressed Check status.
   */
  const platform = platformSenderId();
  if (platform && normalizeSenderId(platform) === normalizeSenderId(id))
    return {
      ok: false,
      error: "That sender ID belongs to FlockInsight itself. Please choose one that names your church.",
    };

  // Don't let two churches claim the same sender ID. Compared the way the
  // network compares them, spaces and case removed: "Grace Church" and
  // "GraceChurch" are one registration there.
  const [taken] = await db
    .select({ id: church.id })
    .from(church)
    .where(
      and(
        ne(church.id, c.id),
        inArray(church.smsSenderStatus, ["approved", "pending"]),
        sql`replace(lower(${church.smsSenderId}), ' ', '') = ${normalizeSenderId(id)}`,
      ),
    )
    .limit(1);
  if (taken)
    return {
      ok: false,
      error: "That sender ID is already in use by another church. Please choose a different one.",
    };

  // Record the request for superadmin review. The superadmin submits it to the
  // network (Termii) — the church isn't submitted directly, so it can be vetted.
  await db
    .update(church)
    .set({
      smsSenderId: id,
      smsSenderStatus: "pending",
      smsSenderStage: null, // awaiting review
      smsSenderNote: cleanNote,
    })
    .where(eq(church.id, c.id));

  await audit({
    churchId: c.id,
    action: "settings.sender_id.create",
    summary: `Requested the SMS sender ID "${id}"`,
    targetType: "church",
    targetId: c.id,
    targetLabel: id,
    meta: { senderId: id, note: cleanNote, previous: c.smsSenderId },
    severity: "notice",
  });

  await notifySuperAdminsByEmail({
    subject: `SMS sender ID request: ${id}`,
    title: "New SMS sender ID request",
    // Escaped: the church writes its name and the note, and this is HTML.
    body: `${escapeHtml(c.name)} has requested the sender ID "${id}".${cleanNote ? ` Note: ${escapeHtml(cleanNote)}.` : ""} Review it and submit to the network.`,
    linkPath: "/superadmin/sms",
  });

  revalidatePath("/settings/sms");
  return { ok: true, outcome: "requested" };
}

export type StatusResult =
  | { ok: true; status: SenderIdStatus }
  | { ok: false; error: string };

/** Ask the network whether the church's requested sender ID is approved yet. */
export async function checkSenderIdStatus(): Promise<StatusResult> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!c.smsSenderId)
    return { ok: false, error: "You haven't requested a sender ID yet." };
  /*
   * Only a request still waiting is the network's to settle, the same rows the
   * reconcile job reads. An ID a superadmin revoked or rejected is still
   * "approved" on the network, and asking it here wrote that straight back.
   */
  if (c.smsSenderStatus === "approved") return { ok: true, status: "approved" };
  if (c.smsSenderStatus !== "pending")
    return {
      ok: false,
      error: "There's no sender ID request waiting to be checked. Request one again below.",
    };

  const lookup = await lookupSenderId(c.smsSenderId);
  // Couldn't reach the network — say so, rather than implying it's still under
  // review (a silent failure here is what left an approved ID stuck on
  // "Processing").
  if (!lookup.ok) return { ok: false, error: lookup.error };
  // Not on the network yet: still with us for review.
  if (!lookup.found) return { ok: true, status: "pending" };

  /*
   * "The network approved this ID" says nothing about WHOSE name it is. The
   * reconcile job asks whoOwns() before it releases anything, so that a church
   * cannot type a neighbouring parish's sender ID (or the platform's own) into
   * the request box and be approved automatically; this button skipped that
   * and wrote "approved" on the spot. Now a contested ID stays with a person,
   * exactly as it does in the job. No stage check: an ID approved on the
   * Termii dashboard is released without one (sender-id-reconcile.ts).
   */
  if (lookup.status === "approved") {
    const conflict = await whoOwns(normalizeSenderId(c.smsSenderId), c.id, new Set());
    if (conflict) {
      // Once an hour per church however often the button is pressed.
      if (rateLimit(`sender-contested:${c.id}`, 1, 60 * 60_000).ok) {
        await notifySuperAdminsByEmail({
          subject: `Contested sender ID: ${c.smsSenderId}`,
          title: "A church asked to be approved for a sender ID that is not theirs",
          // Escaped: the church writes its own name, and this is an HTML email.
          body: `${escapeHtml(c.name)} pressed "Check status" for "${c.smsSenderId}", which the network has approved. It was not released: ${escapeHtml(conflict)}`,
          linkPath: "/superadmin/sms",
        });
      }
      return { ok: true, status: "pending" };
    }
  }

  // Persist a definite verdict so sending/UI reflect it.
  if (lookup.status === "approved" || lookup.status === "rejected") {
    await db
      .update(church)
      .set({
        smsSenderStatus: lookup.status,
        smsSenderStage: null,
        ...(lookup.status === "approved" ? { smsSenderNote: null } : {}),
      })
      .where(eq(church.id, c.id));

    await audit({
      churchId: c.id,
      action: "settings.sender_id.update",
      summary: `The network ${lookup.status} the sender ID "${c.smsSenderId}"`,
      targetType: "church",
      targetId: c.id,
      targetLabel: c.smsSenderId,
      meta: { status: lookup.status },
      severity: lookup.status === "approved" ? "notice" : "warning",
    });

    revalidatePath("/settings/sms");
  }
  return { ok: true, status: lookup.status };
}
