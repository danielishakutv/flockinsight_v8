import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { issueOtp, peekOtp, verifyOtp } from "@/lib/otp";
import { emailLayout, isEmailConfigured, sendEmail } from "@/lib/mailer";
import { isSmsConfigured, normalizePhone, sendSms } from "@/lib/sms";
import { maskEmail, maskPhone } from "@/lib/verification-shared";

/**
 * Church account verification — proving a church owns the email address and
 * phone number FlockInsight has on file for it.
 *
 * Two rules shape this file:
 *
 *  1. The codes go out on the PLATFORM's channels, not the church's. A church
 *     verifying itself has no approved sender ID yet (that's a later step) and
 *     shouldn't pay from its own wallet to prove who it is, so SMS goes via
 *     `sendSms` with the platform sender rather than `sendChurchSms`.
 *  2. A detail and its verified stamp are written in the SAME statement. The
 *     new value only lands once the code for it is confirmed, so a tick can
 *     never end up next to an address nobody proved.
 */

export const EMAIL_PURPOSE = "church_email_verify";
export const PHONE_PURPOSE = "church_phone_verify";

const CODE_MINUTES = 10;

export type StartResult =
  | { ok: true; otpId: string; channel: "email" | "sms"; masked: string }
  | { ok: false; error: string };

export type ConfirmResult =
  | { ok: true; field: "email" | "phone"; value: string }
  | { ok: false; error: string };

/** What we store on the OTP so confirming it knows what to write. */
type VerifyPayload = { field: "email" | "phone"; value: string };

function cleanEmail(input: string): string | null {
  const v = (input || "").trim().toLowerCase();
  // Deliberately loose: one @, something either side, no spaces. Anything
  // stricter rejects real addresses, and the code itself is the real proof.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v.slice(0, 254);
}

/**
 * Start verifying an email address for a church. The address is NOT saved yet
 * — it rides along on the OTP and is written when the code is confirmed.
 */
export async function startEmailVerification(opts: {
  churchId: string;
  churchName: string;
  email: string;
}): Promise<StartResult> {
  const email = cleanEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  if (!isEmailConfigured())
    return {
      ok: false,
      error: "Email isn't configured on the server yet. Please contact support.",
    };

  const issued = await issueOtp({
    churchId: opts.churchId,
    purpose: EMAIL_PURPOSE,
    channel: "email",
    destination: email,
    payload: { field: "email", value: email } satisfies VerifyPayload,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  const html = emailLayout(
    "Verify your church's email address",
    `You asked to verify <b>${email}</b> as the account email for ` +
      `<b>${escapeHtml(opts.churchName)}</b> on FlockInsight.<br><br>` +
      `Your verification code is:` +
      `<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:12px 0">${issued.code}</div>` +
      `This code expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email — nothing changes until the code is entered.`,
  );
  const sent = await sendEmail({
    to: email,
    subject: `Your FlockInsight verification code: ${issued.code}`,
    html,
    text: `Your FlockInsight verification code is ${issued.code}. It expires in ${CODE_MINUTES} minutes.`,
  }).catch(() => false);

  if (!sent)
    return {
      ok: false,
      error: "We couldn't send the code to that address. Check it and try again.",
    };

  return { ok: true, otpId: issued.id, channel: "email", masked: maskEmail(email) };
}

/**
 * Start verifying a phone number for a church. Sent from the platform's Termii
 * sender ID, at the platform's cost — the church's wallet is never touched.
 */
export async function startPhoneVerification(opts: {
  churchId: string;
  churchName: string;
  phone: string;
}): Promise<StartResult> {
  const phone = normalizePhone(opts.phone || "");
  if (!phone)
    return {
      ok: false,
      error: "Enter a valid phone number, e.g. 08012345678.",
    };

  if (!isSmsConfigured())
    return {
      ok: false,
      error: "SMS isn't configured on the server yet. Please contact support.",
    };

  const issued = await issueOtp({
    churchId: opts.churchId,
    purpose: PHONE_PURPOSE,
    channel: "sms",
    destination: phone,
    payload: { field: "phone", value: phone } satisfies VerifyPayload,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  const res = await sendSms({
    to: phone,
    message: `FlockInsight: ${issued.code} is your verification code for ${opts.churchName}. It expires in ${CODE_MINUTES} minutes.`,
  });
  if (!res.ok)
    return {
      ok: false,
      error:
        "We couldn't send a code to that number. Check it and try again, or contact support.",
    };

  return { ok: true, otpId: issued.id, channel: "sms", masked: maskPhone(phone) };
}

/**
 * Confirm a code and apply what it authorises: the new email/phone is written
 * together with its verified stamp.
 *
 * `churchId` is checked against the one the code was issued for, so a code sent
 * to one church can never verify a detail on another.
 */
export async function confirmVerification(opts: {
  churchId: string;
  otpId: string;
  code: string;
}): Promise<ConfirmResult> {
  // Ownership is checked BEFORE the code, because `verifyOtp` consumes a
  // correct code as soon as it matches — checking afterwards would burn a
  // perfectly good code on a request that was always going to be refused.
  const owner = await peekOtp(opts.otpId);
  if (!owner)
    return { ok: false, error: "This code is no longer valid. Please start again." };
  if (owner.churchId && owner.churchId !== opts.churchId)
    return { ok: false, error: "This code was issued for a different church." };
  if (owner.purpose !== EMAIL_PURPOSE && owner.purpose !== PHONE_PURPOSE)
    return { ok: false, error: "This code can't be used here." };

  const res = await verifyOtp(opts.otpId, opts.code);
  if (!res.ok) return res;

  const payload = res.payload as VerifyPayload | null;
  if (!payload?.field || !payload.value)
    return { ok: false, error: "This code is no longer valid. Please start again." };

  // Read the outgoing value first: once it's overwritten there is no way back
  // to the address that should be warned the account contact just moved.
  const [before] = await db
    .select({
      name: church.name,
      contactEmail: church.contactEmail,
      emailVerifiedAt: church.emailVerifiedAt,
    })
    .from(church)
    .where(eq(church.id, opts.churchId))
    .limit(1);

  const now = new Date();
  if (payload.field === "email") {
    await db
      .update(church)
      .set({ contactEmail: payload.value, emailVerifiedAt: now })
      .where(eq(church.id, opts.churchId));
    await warnOldAddress(before, payload.value);
  } else {
    await db
      .update(church)
      .set({ contactPhone: payload.value, phoneVerifiedAt: now })
      .where(eq(church.id, opts.churchId));
  }

  return { ok: true, field: payload.field, value: payload.value };
}

/**
 * Tell the address that just LOST the account that it did.
 *
 * Whoever is being displaced is the person best placed to notice a change they
 * didn't authorise — and after the swap they'd never hear from us again. Only
 * sent when the old address was itself verified, so we aren't mailing an
 * address nobody ever proved.
 */
async function warnOldAddress(
  before:
    | { name: string; contactEmail: string | null; emailVerifiedAt: Date | null }
    | undefined,
  newEmail: string,
): Promise<void> {
  const old = before?.contactEmail?.trim().toLowerCase();
  if (!old || !before?.emailVerifiedAt || old === newEmail) return;
  try {
    await sendEmail({
      to: old,
      subject: "Your church's FlockInsight account email was changed",
      html: emailLayout(
        "Your account email was changed",
        `The account email for <b>${escapeHtml(before.name)}</b> on FlockInsight was changed ` +
          `from this address to <b>${escapeHtml(newEmail)}</b>, confirmed with a code sent to the new address.<br><br>` +
          `If you made this change, nothing more is needed. If you didn't, contact us immediately — ` +
          `someone else may have access to your church's account.`,
      ),
      text: `The FlockInsight account email for ${before.name} was changed from this address to ${newEmail}. If this wasn't you, contact us immediately.`,
    });
  } catch (e) {
    console.error("[verification] could not warn the previous address", e);
  }
}

/**
 * Congratulate a church the moment both details are confirmed. Called after a
 * successful confirm; does nothing unless this was the second of the two.
 */
export async function announceIfNowVerified(churchId: string): Promise<boolean> {
  const [c] = await db
    .select({
      name: church.name,
      contactEmail: church.contactEmail,
      contactPhone: church.contactPhone,
      emailVerifiedAt: church.emailVerifiedAt,
      phoneVerifiedAt: church.phoneVerifiedAt,
    })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c) return false;

  const { isChurchVerified } = await import("@/lib/verification-shared");
  if (!isChurchVerified(c)) return false;

  const { notifyChurchManagers } = await import("@/lib/notifications");
  await notifyChurchManagers({
    churchId,
    title: "Your church is verified ✅",
    body: `${c.name} is now a verified church on FlockInsight. A verification tick shows on your public page and in the church directory.`,
    linkUrl: "/settings/verification",
    email: { subject: "Your church is verified on FlockInsight ✅" },
  });
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
