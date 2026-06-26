"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsTopup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import { isSmsConfigured } from "@/lib/sms";
import {
  requestSenderId,
  fetchSenderIdStatus,
  type SenderIdStatus,
} from "@/lib/termii-sender";

export type ActionResult = { ok: true } | { ok: false; error: string };

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
): Promise<ActionResult> {
  const id = (senderId || "").trim();
  if (!/^[A-Za-z0-9 ]{3,11}$/.test(id))
    return {
      ok: false,
      error: "Sender ID must be 3–11 letters or numbers (no symbols).",
    };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  if (!isSmsConfigured())
    return { ok: false, error: "SMS isn't enabled on the platform yet." };

  // Register the sender ID with Termii for review.
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
      smsSenderNote: (note || "").trim().slice(0, 500) || null,
    })
    .where(eq(church.id, c.id));

  revalidatePath("/settings/sms");
  return { ok: true };
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
