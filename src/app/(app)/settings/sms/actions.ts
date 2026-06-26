"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, smsTopup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import { isSmsConfigured } from "@/lib/sms";
import {
  requestSenderId,
  fetchSenderIdInfo,
  fetchSenderIdStatus,
  type SenderIdStatus,
} from "@/lib/termii-sender";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type ApplyResult =
  | { ok: true; outcome: "approved" | "pending" | "requested" }
  | { ok: false; error: string };

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";
const MIN_TOPUP = 100;

export type TopupResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function startSmsTopup(amount: number): Promise<TopupResult> {
  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!Number.isFinite(amount) || amount < MIN_TOPUP)
    return { ok: false, error: `Minimum top-up is ₦${MIN_TOPUP}.` };
  if (amount > 10_000_000)
    return { ok: false, error: "That amount is too large." };
  if (!isPaystackConfigured())
    return { ok: false, error: "Online payment isn't set up yet. Contact us." };

  const reference = `SMS-${c.id.slice(0, 8)}-${Date.now()}`;
  await db
    .insert(smsTopup)
    .values({ churchId: c.id, amount, reference, createdBy: user.id });

  const init = await paystackInit({
    email: user.email,
    amountNaira: amount,
    reference,
    callbackUrl: `${BASE_URL}/settings/sms/callback`,
    metadata: { kind: "sms_topup", churchId: c.id, amount },
  });
  if (!init.ok) return init;
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

  const cleanNote = (note || "").trim().slice(0, 500) || null;

  // Don't let two churches claim the same sender ID.
  const [taken] = await db
    .select({ id: church.id })
    .from(church)
    .where(
      and(
        ne(church.id, c.id),
        inArray(church.smsSenderStatus, ["approved", "pending"]),
        sql`lower(${church.smsSenderId}) = ${id.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (taken)
    return {
      ok: false,
      error: "That sender ID is already in use by another church. Please choose a different one.",
    };

  // Check Termii FIRST so we never submit a duplicate request for an ID that
  // already exists (active or pending) on the account.
  const info = await fetchSenderIdInfo(id);
  if (info.found) {
    if (info.status === "approved") {
      await db
        .update(church)
        .set({ smsSenderId: id, smsSenderStatus: "approved", smsSenderNote: null })
        .where(eq(church.id, c.id));
      revalidatePath("/settings/sms");
      return { ok: true, outcome: "approved" };
    }
    if (info.status === "pending") {
      await db
        .update(church)
        .set({ smsSenderId: id, smsSenderStatus: "pending", smsSenderNote: cleanNote })
        .where(eq(church.id, c.id));
      revalidatePath("/settings/sms");
      return { ok: true, outcome: "pending" };
    }
    // Blocked/rejected on Termii — re-requesting the same ID won't help.
    return {
      ok: false,
      error: "That sender ID was blocked or rejected by the network. Please choose a different one.",
    };
  }

  // Brand-new ID → submit a request to Termii for review.
  const reg = await requestSenderId({
    senderId: id,
    usecase: (note || "").trim() || "Church service alerts and member updates",
    company: c.name,
  });
  if (!reg.ok) return { ok: false, error: reg.error };

  await db
    .update(church)
    .set({
      smsSenderId: id,
      smsSenderStatus: "pending",
      smsSenderNote: cleanNote,
    })
    .where(eq(church.id, c.id));

  revalidatePath("/settings/sms");
  return { ok: true, outcome: "requested" };
}

export type StatusResult =
  | { ok: true; status: SenderIdStatus }
  | { ok: false; error: string };

/** Ask Termii whether the church's requested sender ID is approved yet. */
export async function checkSenderIdStatus(): Promise<StatusResult> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!c.smsSenderId)
    return { ok: false, error: "You haven't requested a sender ID yet." };

  const status = await fetchSenderIdStatus(c.smsSenderId);

  // Persist a definite verdict so sending/UI reflect it.
  if (status === "approved" || status === "rejected") {
    await db
      .update(church)
      .set({ smsSenderStatus: status })
      .where(eq(church.id, c.id));
    revalidatePath("/settings/sms");
  }
  return { ok: true, status };
}
