import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { issueOtp, peekOtp, verifyOtp } from "@/lib/otp";
import { emailLayout, isEmailConfigured, sendEmail } from "@/lib/mailer";
import { isSmsConfigured, normalizePhone, sendSms } from "@/lib/sms";
import { maskEmail, maskPhone } from "@/lib/verification-shared";
import { escapeHtml } from "@/lib/html-escape";

/**
 * Changing the email address or phone number on a PERSON's account.
 *
 * The same shape as `church-verification.ts`, for the same reasons, with one
 * difference that matters: an email address here is a login. Letting somebody
 * type a new one and press Save would mean a borrowed laptop is enough to move
 * an account — the real owner locked out of the address they still control, and
 * no record anywhere of where it went.
 *
 * So, three rules:
 *
 *  1. The code goes to the NEW destination, which is the only thing that proves
 *     the person asking can actually receive mail there. Nothing is written
 *     until it comes back.
 *  2. The code is bound to the user id it was issued for, checked before the
 *     code is spent. A code mailed to one account cannot move another.
 *  3. The address that LOSES the account is told it lost it. Whoever is being
 *     displaced is the one person certain to notice a change they did not make,
 *     and after the swap we would never write to them again.
 *
 * Codes go out on the PLATFORM's channels (`sendSms`, not `sendChurchSms`):
 * proving who you are is not something a church should pay for out of its
 * wallet, and the person may not even have an approved sender ID.
 */

export const EMAIL_PURPOSE = "account_email_change";
export const PHONE_PURPOSE = "account_phone_change";

const CODE_MINUTES = 10;

export type StartResult =
  | { ok: true; otpId: string; channel: "email" | "sms"; masked: string }
  | { ok: false; error: string };

export type ConfirmResult =
  | { ok: true; field: "email" | "phone"; value: string }
  | { ok: false; error: string };

/** What rides along on the code so confirming it knows what to write, and for whom. */
type ChangePayload = { userId: string; field: "email" | "phone"; value: string };

function cleanEmail(input: string): string | null {
  const v = (input || "").trim().toLowerCase();
  // Deliberately loose — one @, something either side, no spaces. Anything
  // stricter rejects real addresses, and the code itself is the real proof.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v.slice(0, 254);
}

/**
 * Start moving an account to a new email address.
 *
 * The address is NOT saved here. It is carried on the code and written only
 * when the code sent to it comes back.
 */
export async function startEmailChange(opts: {
  userId: string;
  userName: string;
  currentEmail: string;
  email: string;
}): Promise<StartResult> {
  const email = cleanEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  if (email === opts.currentEmail.trim().toLowerCase())
    return { ok: false, error: "That's already your email address." };

  if (!isEmailConfigured())
    return {
      ok: false,
      error: "Email isn't configured on the server yet. Please contact support.",
    };

  /*
   * Checked here for a decent message, and AGAIN at confirm time because
   * somebody else can sign up with this address in the ten minutes in between.
   * The unique index is the thing that actually guarantees it.
   */
  if (await emailTaken(email, opts.userId))
    return {
      ok: false,
      error: "That email address is already used by another account.",
    };

  const issued = await issueOtp({
    churchId: null,
    purpose: EMAIL_PURPOSE,
    channel: "email",
    destination: email,
    payload: {
      userId: opts.userId,
      field: "email",
      value: email,
    } satisfies ChangePayload,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  const sent = await sendEmail({
    to: email,
    subject: `Your FlockInsight verification code: ${issued.code}`,
    html: emailLayout(
      "Confirm your new email address",
      `Someone asked to use <b>${escapeHtml(email)}</b> as the sign-in email for the ` +
        `FlockInsight account of <b>${escapeHtml(opts.userName)}</b>.<br><br>` +
        `Your verification code is:` +
        `<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:12px 0">${issued.code}</div>` +
        `This code expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email — ` +
        `nothing changes until the code is entered, and the account keeps the address it has.`,
    ),
    text: `Your FlockInsight verification code is ${issued.code}. It expires in ${CODE_MINUTES} minutes.`,
  }).catch(() => false);

  if (!sent)
    return {
      ok: false,
      error: "We couldn't send the code to that address. Check it and try again.",
    };

  return { ok: true, otpId: issued.id, channel: "email", masked: maskEmail(email) };
}

/** Start verifying a new phone number for a person. */
export async function startPhoneChange(opts: {
  userId: string;
  userName: string;
  phone: string;
}): Promise<StartResult> {
  const phone = normalizePhone(opts.phone || "");
  if (!phone)
    return { ok: false, error: "Enter a valid phone number, e.g. 08012345678." };

  if (!isSmsConfigured())
    return {
      ok: false,
      error: "SMS isn't configured on the server yet. Please contact support.",
    };

  const issued = await issueOtp({
    churchId: null,
    purpose: PHONE_PURPOSE,
    channel: "sms",
    destination: phone,
    payload: {
      userId: opts.userId,
      field: "phone",
      value: phone,
    } satisfies ChangePayload,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  const res = await sendSms({
    to: phone,
    message: `FlockInsight: ${issued.code} is your verification code. It expires in ${CODE_MINUTES} minutes.`,
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
 * Confirm a code and apply what it authorises.
 *
 * `userId` is the signed-in person. It is checked against the id on the code
 * BEFORE the code is spent — `verifyOtp` consumes a correct code the instant it
 * matches, so a check that happens afterwards burns a good code on a request
 * that was never going to be allowed.
 */
export async function confirmAccountChange(opts: {
  userId: string;
  otpId: string;
  code: string;
}): Promise<ConfirmResult> {
  const owner = await peekOtp(opts.otpId);
  if (!owner)
    return { ok: false, error: "This code is no longer valid. Please start again." };
  if (owner.purpose !== EMAIL_PURPOSE && owner.purpose !== PHONE_PURPOSE)
    return { ok: false, error: "This code can't be used here." };

  const pending = owner.payload as ChangePayload | null;
  if (!pending?.userId || pending.userId !== opts.userId)
    return { ok: false, error: "This code was issued for a different account." };

  const res = await verifyOtp(opts.otpId, opts.code);
  if (!res.ok) return res;

  const payload = res.payload as ChangePayload | null;
  if (!payload?.field || !payload.value)
    return { ok: false, error: "This code is no longer valid. Please start again." };

  // Read what is about to be overwritten first: once it's gone there is no way
  // back to the address that should be warned the account has moved.
  const [before] = await db
    .select({
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, opts.userId))
    .limit(1);
  if (!before) return { ok: false, error: "Account not found." };

  if (payload.field === "email") {
    if (await emailTaken(payload.value, opts.userId))
      return {
        ok: false,
        error: "That email address is already used by another account.",
      };
    try {
      await db
        .update(user)
        .set({
          email: payload.value,
          // Proved, by the code that just arrived there. Marking it anything
          // else would lock the person out of an address they just confirmed.
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(user.id, opts.userId));
    } catch (e) {
      // The unique index is the real guarantee, and losing that race is not a
      // crash — it is a message.
      console.error("[account] email change failed", e);
      return {
        ok: false,
        error: "That email address is already used by another account.",
      };
    }
    await warnOldAddress(before, payload.value);
  } else {
    await db
      .update(user)
      .set({
        phone: payload.value,
        phoneVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(user.id, opts.userId));
  }

  return { ok: true, field: payload.field, value: payload.value };
}

/** Is this address on somebody else's account? */
async function emailTaken(email: string, exceptUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, email), ne(user.id, exceptUserId)))
    .limit(1);
  return !!row;
}

/**
 * Tell the address that just lost the account that it did.
 *
 * Only sent when the old address was itself verified — we aren't mailing an
 * address nobody ever proved — and never when it is the same address.
 */
async function warnOldAddress(
  before: { name: string; email: string; emailVerified: boolean },
  newEmail: string,
): Promise<void> {
  const old = before.email.trim().toLowerCase();
  if (!old || !before.emailVerified || old === newEmail) return;
  try {
    await sendEmail({
      to: old,
      subject: "Your FlockInsight sign-in email was changed",
      html: emailLayout(
        "Your sign-in email was changed",
        `The FlockInsight account of <b>${escapeHtml(before.name)}</b> was moved from this ` +
          `address to <b>${escapeHtml(newEmail)}</b>, confirmed with a code sent to the new address.<br><br>` +
          `You will no longer be able to sign in with this address. If you made this change, ` +
          `nothing more is needed. If you did not, contact us immediately — somebody else may ` +
          `have access to your account.`,
      ),
      text: `The FlockInsight account of ${before.name} was moved from this address to ${newEmail}. If this wasn't you, contact us immediately.`,
    });
  } catch (e) {
    console.error("[account] could not warn the previous address", e);
  }
}
