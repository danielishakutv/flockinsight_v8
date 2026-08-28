"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  announceIfNowVerified,
  confirmVerification,
  startEmailVerification,
  startPhoneVerification,
} from "@/lib/church-verification";

/**
 * Verifying — and changing — the church's account email and phone number.
 *
 * A change and a first-time verification are the same action deliberately:
 * both end with a code sent to the destination, and neither writes anything
 * until that code comes back. That's what makes "change my email" safe to
 * expose to a church at all — the new address has to answer for itself.
 */

export type StartResult =
  | { ok: true; otpId: string; masked: string }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

const NO_PERMISSION = {
  ok: false as const,
  error: "You don't have permission to manage church settings.",
};

const emailSchema = z.string().trim().min(3).max(254);
const phoneSchema = z.string().trim().min(6).max(20);
const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");
const otpIdSchema = z.string().uuid();

/** Send a verification code to an email address (new or the current one). */
export async function sendEmailCode(email: string): Promise<StartResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_PERMISSION;

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };

  const res = await startEmailVerification({
    churchId: church.id,
    churchName: church.name,
    email: parsed.data,
  });
  if (!res.ok) return res;
  return { ok: true, otpId: res.otpId, masked: res.masked };
}

/** Send a verification code by SMS to a phone number (new or the current one). */
export async function sendPhoneCode(phone: string): Promise<StartResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_PERMISSION;

  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success)
    return { ok: false, error: "Enter a valid phone number, e.g. 08012345678." };

  const res = await startPhoneVerification({
    churchId: church.id,
    churchName: church.name,
    phone: parsed.data,
  });
  if (!res.ok) return res;
  return { ok: true, otpId: res.otpId, masked: res.masked };
}

/** Confirm a code — this is the step that actually saves the detail. */
export async function confirmCode(
  otpId: string,
  code: string,
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_PERMISSION;

  if (!otpIdSchema.safeParse(otpId).success)
    return { ok: false, error: "This code is no longer valid. Please start again." };
  const parsedCode = codeSchema.safeParse(code);
  if (!parsedCode.success)
    return { ok: false, error: parsedCode.error.issues[0]?.message ?? "Invalid code." };

  const res = await confirmVerification({
    churchId: church.id,
    otpId,
    code: parsedCode.data,
  });
  if (!res.ok) return res;

  await announceIfNowVerified(church.id);

  revalidatePath("/settings/verification");
  revalidatePath("/dashboard");
  revalidatePath("/churches");
  // The public page caches for an hour (`revalidate = 3600`), so without this
  // a church that just verified wouldn't see its own tick until the cache
  // turned over — the one place they're most likely to go and look.
  if (church.handle) revalidatePath(`/c/${church.handle}`);
  return { ok: true };
}
