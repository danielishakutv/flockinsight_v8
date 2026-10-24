"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { headers } from "next/headers";
import {
  otpCode,
  partner,
  partnerReferral,
  session as sessionTable,
  supportMessage,
  supportTicket,
  user as userTable,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import {
  createPartner,
  hasOpenPayout,
  partnerForUser,
  partnerTierNow,
  partnerWallet,
  requestPayout,
} from "@/lib/partners";
import {
  bankChangeKeepsVerification,
  bankDetailsChanged,
  canonicalPhone,
  canWithdraw,
  maskAccount,
  otpBelongsToPartner,
  otpDestination,
  PARTNER_OTP_LIMITS,
} from "@/lib/partners-shared";
import { issueOtp, peekOtp, verifyOtp } from "@/lib/otp";
import { emailLayout, sendEmail } from "@/lib/mailer";
import { sendSms } from "@/lib/sms";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { escapeHtml } from "@/lib/html-escape";
import { notifyBankChanged } from "@/lib/partner-notices";
import { setDigestOptOut } from "@/lib/partner-digest";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Everything a Partner can do for themselves.
 *
 * Every one of these starts by resolving the partner row from the SESSION, not
 * from an id in the request. A Partner may only ever act on their own wallet,
 * their own bank details and their own churches, and the only way to guarantee
 * that is to never accept a partner id from a browser at all.
 */
async function me() {
  const { user } = await requireUser();
  const row = await partnerForUser(user.id);
  return { user, partner: row };
}

/* ============================================================
 * Applying
 * ========================================================== */

const joinSchema = z.object({
  displayName: z.string().trim().min(2, "Tell us your name").max(120),
  phone: z.string().trim().max(30).optional(),
});

/**
 * A typed phone number that cannot be read is refused, not dropped.
 *
 * `createPartner` stores `canonicalPhone(x) || null`, so a number one digit
 * short used to become "no number" while the form said "You're in" — and the
 * Partner found out at their first withdrawal, which needs a verified number.
 */
const PHONE_UNREADABLE =
  "That phone number looks incomplete — check the digits, or leave it blank for now.";
function phoneProblem(raw: string | undefined): string | null {
  const typed = (raw ?? "").trim();
  return typed && !canonicalPhone(typed) ? PHONE_UNREADABLE : null;
}

/**
 * Join the programme with the account you are signed in with.
 *
 * This is the "merge": a church owner, a member of staff or a platform
 * operator becomes a Partner on the SAME login. Nothing about their church
 * changes — the Partner row hangs off the user, not off any church — and they
 * move between the two from the account menu.
 */
export async function applyToBePartner(
  input: z.input<typeof joinSchema>,
): Promise<ActionResult> {
  const { user } = await requireUser("/partner/join");
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const badPhone = phoneProblem(parsed.data.phone);
  if (badPhone) return { ok: false, error: badPhone };

  const res = await createPartner({
    userId: user.id,
    displayName: parsed.data.displayName,
    phone: parsed.data.phone || null,
  });
  if (!res.ok) return res;

  revalidatePath("/partner");
  return { ok: true };
}

const accountSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a complete email address").max(254),
  password: z
    .string()
    .min(8, "Your password needs at least 8 characters")
    .max(128, "That password is too long"),
  phone: z.string().trim().max(30).optional(),
});

export type PartnerAccountResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; error: string; existingAccount?: boolean };

/**
 * A new FlockInsight login that is a Partner and nothing else.
 *
 * Until this existed, the only way to make an account was the church sign-up,
 * which creates a church — so an agent who wanted to bring churches had to
 * invent one of their own first, or was bounced to a login page for an account
 * they did not have.
 *
 * No church is created, no member profile, no trial. The account is the
 * person; the Partner row is what they do. If they later start or join a
 * church, it is the same login.
 *
 * An email that already has an account is refused with `existingAccount`, and
 * the page offers to log in and add Partner to THAT account instead. One
 * person, one login: a second account for the same mailbox is not possible,
 * and a second one under another address would split their churches from
 * their commission.
 */
export async function createPartnerAccount(
  input: z.input<typeof accountSchema>,
): Promise<PartnerAccountResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { name, email, password, phone } = parsed.data;

  const badPhone = phoneProblem(phone);
  if (badPhone) return { ok: false, error: badPhone };

  /*
   * Ten an hour from one address. Each attempt can create a real account and
   * send a real email, and an honest person needs one — two if they mistype.
   */
  if (!rateLimit(`partner-signup:${await clientIp()}`, 10, 60 * 60_000).ok) {
    return {
      ok: false,
      error: "Too many sign-ups from this connection. Try again in an hour.",
    };
  }

  /*
   * Checked before `signUpEmail`, which with verification on answers an
   * existing address with a synthetic user rather than an error. Telling them
   * here costs nothing the church sign-up does not already say on blur.
   */
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(sql`lower(${userTable.email}) = ${email}`)
    .limit(1);
  if (existing) {
    return {
      ok: false,
      existingAccount: true,
      error:
        "That email already has a FlockInsight account. Log in with it and we'll add Partner to the same account.",
    };
  }

  let userId: string | undefined;
  try {
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name },
      headers: await headers(),
    });
    userId = signUp?.user?.id;
  } catch (e) {
    const message =
      (e as { body?: { message?: string } })?.body?.message ??
      (e as { message?: string })?.message;
    console.error("[partners] account sign-up failed", e);
    return { ok: false, error: message || "We couldn't create your account." };
  }

  // The anti-enumeration answer: a user id that is not in the database. Lost a
  // race with somebody signing up the same address a moment ago.
  const [realUser] = userId
    ? await db
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1)
    : [];
  if (!realUser) {
    return {
      ok: false,
      existingAccount: true,
      error:
        "That email already has a FlockInsight account. Log in with it and we'll add Partner to the same account.",
    };
  }

  const res = await createPartner({
    userId: realUser.id,
    displayName: name,
    phone: phone || null,
  });
  if (!res.ok) {
    /*
     * The login exists and the Partner row does not. Not a dead end: signing
     * in brings them straight back to /partner/join, which now offers the
     * one-click "join with this account".
     */
    console.error("[partners] account created but Partner row failed", res.error);
    return {
      ok: false,
      existingAccount: true,
      error:
        "Your account was created, but we couldn't finish making you a Partner. Log in and press Join — it takes one click.",
    };
  }

  // With verification off, sign-up already signed them in (nextCookies set the
  // cookie on this response). With it on, there is no session until the link
  // in their inbox is opened — and that link brings them to the dashboard.
  const [live] = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.userId, realUser.id))
    .limit(1);
  const signedIn = !!live;

  if (!signedIn) {
    try {
      await auth.api.sendVerificationEmail({
        body: { email, callbackURL: "/partner" },
        headers: await headers(),
      });
    } catch (e) {
      // The login page offers a resend to anybody who tries to sign in
      // unverified, so this is recoverable — but it must be visible.
      console.error("[partners] verification email failed", e);
    }
  }

  revalidatePath("/partner");
  return { ok: true, signedIn };
}

/* ============================================================
 * Bank details
 * ========================================================== */

const bankSchema = z.object({
  bankName: z.string().trim().min(2, "Which bank?").max(80),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "An account number is digits only"),
  bankAccountName: z.string().trim().min(2, "The name on the account").max(120),
});

/**
 * Where a Partner's money goes.
 *
 * Changing it is the one thing somebody holding a stolen session would want to
 * do, so a change of account is treated as what it is:
 *
 * - it clears the email verification unless a code was confirmed in the last
 *   few minutes (`bankChangeKeepsVerification`). Nothing can be withdrawn to
 *   the new account until the Partner proves, again, that they read the inbox
 *   on file — the one address a session cannot change;
 * - it tells them, by email to that address and by text to a verified number,
 *   naming the new account, so a change they did not make is seen before a
 *   withdrawal to it could be paid;
 * - saving the same details again sends nothing. A correction that only
 *   changes capitals or spacing (the same account, by `bankDetailsChanged`) is
 *   saved quietly — it is not a new destination, so it neither notifies nor
 *   clears verification, but it is not thrown away either.
 *
 * `reverify: true` tells the form that withdrawals are now blocked until the
 * email is confirmed again, so the Partner hears it at the moment of saving
 * rather than when a later withdrawal is refused.
 */
export type BankSaveResult =
  | { ok: true; reverify: boolean; message?: string }
  | { ok: false; error: string };

export async function savePartnerBank(
  input: z.input<typeof bankSchema>,
): Promise<BankSaveResult> {
  const { user, partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };

  const parsed = bankSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const next = {
    bankName: parsed.data.bankName,
    bankAccountNumber: parsed.data.bankAccountNumber,
    bankAccountName: parsed.data.bankAccountName,
  };
  if (!bankDetailsChanged(p, next)) {
    const sameSpelling =
      (p.bankName ?? "") === next.bankName &&
      (p.bankAccountNumber ?? "") === next.bankAccountNumber &&
      (p.bankAccountName ?? "") === next.bankAccountName;
    if (!sameSpelling) {
      await db.update(partner).set(next).where(eq(partner.id, p.id));
      revalidatePath("/partner");
    }
    return { ok: true, reverify: false };
  }

  const limit = rateLimit(
    `partner-bank:${p.id}`,
    PARTNER_OTP_LIMITS.bankChangesPerDay,
    24 * 60 * 60_000,
  );
  if (!limit.ok) {
    return {
      ok: false,
      error: "Your account details have been changed too many times today. Try again tomorrow.",
    };
  }

  const keepsVerification = bankChangeKeepsVerification(p.emailVerifiedAt);
  await db
    .update(partner)
    .set({
      ...next,
      ...(keepsVerification ? {} : { emailVerifiedAt: null }),
    })
    .where(eq(partner.id, p.id));

  // Somebody adding their first account is told too: a balance can be waiting
  // for an account to exist, and that is the moment a stolen session would
  // pick to add one.
  await notifyBankChanged({
    email: user.email ?? null,
    phone: p.phoneVerifiedAt ? p.phone : null,
    code: p.code,
    displayName: p.displayName,
    bank: next,
    hadAccount: !!(p.bankName || p.bankAccountNumber || p.bankAccountName),
    reverify: !keepsVerification,
  });

  console.info(
    `[partners] ${p.code} changed their payout account to ${next.bankName} ${maskAccount(next.bankAccountNumber)}` +
      (keepsVerification ? " (fresh email code)" : " — email verification cleared"),
  );

  revalidatePath("/partner");
  return keepsVerification
    ? { ok: true, reverify: false }
    : {
        ok: true,
        reverify: true,
        message:
          "Account details saved. Confirm your email address again before you can withdraw.",
      };
}

/* ============================================================
 * Verifying who they are
 *
 * A payout goes to a person we actually reached, so both the email and the
 * phone are confirmed before one can be requested. Reuses the platform's own
 * OTP rather than inventing a second one.
 * ========================================================== */

export async function sendPartnerOtp(
  which: "email" | "phone",
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { user, partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };
  // Pending Partners may verify while they wait for approval; a paused or
  // suspended one has nothing to verify for while it lasts, and is not
  // spending our SMS balance.
  if (p.status === "suspended" || p.status === "paused") {
    return {
      ok: false,
      error: `Your Partner account is ${p.status}. Please contact support.`,
    };
  }

  const raw = which === "email" ? (user.email ?? "") : (p.phone ?? "");
  const destination = raw ? otpDestination(which, raw) : "";
  if (!destination) {
    return {
      ok: false,
      error:
        which === "phone"
          ? "Add your phone number first."
          : "Your account has no email address.",
    };
  }

  /*
   * A text costs us money and an email does not, so the inbox is proved
   * first: a throwaway account has to show a real email address before it can
   * make the platform pay for a single SMS.
   */
  if (which === "phone" && !p.emailVerifiedAt) {
    return { ok: false, error: "Verify your email address first, then your phone." };
  }

  const refused = await otpSendRefused(p.id, destination);
  if (refused) return { ok: false, error: refused };

  const issued = await issueOtp({
    // No church: a Partner is a person, not a congregation.
    churchId: null,
    destination,
    channel: which === "email" ? "email" : "sms",
    purpose: `partner_${which}`,
    /*
     * Who this code belongs to, so confirming it can prove the code was sent
     * to THIS Partner for THIS field. Without it, any valid code from any
     * other flow could be handed to `confirmPartnerOtp` to mark a phone
     * verified that was never texted — and phone verification is one of the
     * gates on withdrawing money. Checked with `peekOtp` before the code is
     * spent; see the note there on why that order matters. It is also what
     * the daily ceiling in `otpSendRefused` counts by.
     */
    payload: { partnerId: p.id, which, destination },
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  /*
   * `issueOtp` stores the code and hands back the plaintext for the caller to
   * deliver — so delivery is this function's job, and a code that was stored
   * but never sent would be a form that can never be completed.
   *
   * The SMS goes through the platform's own Termii credentials rather than a
   * church's wallet, because there is no church here to charge. That is a real
   * cost on us per Partner, which is why it is rate limited above and why the
   * email has to be verified first.
   */
  let sent = false;
  try {
    sent =
      which === "email"
        ? await sendEmail({
            to: destination,
            subject: `Your FlockInsight Partner code: ${issued.code}`,
            html: emailLayout(
              "Confirm your email address",
              `Your Partner verification code is:` +
                `<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:12px 0">${issued.code}</div>` +
                `It expires shortly. If you did not ask for it, ignore this email — nothing changes until the code is entered.`,
            ),
            text: `Your FlockInsight Partner verification code is ${issued.code}.`,
          })
        : await sendSms({
            to: destination,
            message: `Your FlockInsight Partner verification code is ${issued.code}.`,
          }).then((r) => {
            if (!r.ok) console.warn(`[partners] ${p.code}: OTP SMS not sent: ${r.error}`);
            return r.ok;
          });
  } catch (e) {
    console.error(`[partners] ${p.code}: could not send the ${which} code`, e);
    sent = false;
  }

  if (!sent) {
    return {
      ok: false,
      error:
        which === "email"
          ? "We couldn't send the code to that address. Check it and try again."
          : "We couldn't send the code to that number. Check it and try again.",
    };
  }

  return { ok: true, id: issued.id };
}

/**
 * Why another code may not be sent right now, or null when it may.
 *
 * The burst limits are in memory (cheap, per worker); the daily ones count
 * the codes actually stored, so a restart or a second worker cannot reset
 * them. Both the Partner and the destination are counted: one Partner cannot
 * text a list of numbers, and many accounts cannot all text one number.
 */
async function otpSendRefused(partnerId: string, destination: string): Promise<string | null> {
  const HOUR = 60 * 60_000;
  const tooMany = "Too many codes requested. Please wait a while and try again.";
  const ip = await clientIp();
  for (const [key, max] of [
    [`partner-otp:partner:${partnerId}`, PARTNER_OTP_LIMITS.perPartnerHour],
    [`partner-otp:dest:${destination}`, PARTNER_OTP_LIMITS.perDestinationHour],
    [`partner-otp:ip:${ip}`, PARTNER_OTP_LIMITS.perIpHour],
  ] as const) {
    if (!rateLimit(key, max, HOUR).ok) return tooMany;
  }

  const since = new Date(Date.now() - 24 * HOUR);
  const purposes = ["partner_email", "partner_phone"];
  const [[mine], [theirs]] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(otpCode)
      .where(
        and(
          inArray(otpCode.purpose, purposes),
          gt(otpCode.createdAt, since),
          // A flat expression on one table: nothing here can lose a qualifier.
          sql`${otpCode.payload}->>'partnerId' = ${partnerId}`,
        ),
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(otpCode)
      .where(
        and(
          inArray(otpCode.purpose, purposes),
          gt(otpCode.createdAt, since),
          eq(otpCode.destination, destination),
        ),
      ),
  ]);
  if (Number(mine?.c ?? 0) >= PARTNER_OTP_LIMITS.perPartnerDay) {
    return "You have asked for a lot of codes today. Please try again tomorrow, or contact support.";
  }
  if (Number(theirs?.c ?? 0) >= PARTNER_OTP_LIMITS.perDestinationDay) {
    return "That address or number has had too many codes today. Please try again tomorrow.";
  }
  return null;
}

const confirmSchema = z.object({
  which: z.enum(["email", "phone"]),
  id: z.string().uuid(),
  code: z.string().trim().regex(/^[0-9]{6}$/, "Enter the 6-digit code"),
});

export async function confirmPartnerOtp(
  input: z.input<typeof confirmSchema>,
): Promise<ActionResult> {
  const { user, partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { which, id, code } = parsed.data;

  /*
   * Prove the code is ours BEFORE spending it.
   *
   * `verifyOtp` marks a correct code consumed the moment it matches, so every
   * check that could reject the attempt on other grounds has to happen first
   * or a valid code is burned by a request that was never going to succeed.
   * That is what `peekOtp` is for.
   *
   * Three things are checked, and each one closes a real hole. Without the
   * PURPOSE check, a code from any other flow — including the Partner's own
   * email verification — could be submitted as `which: "phone"` and mark a
   * number verified that was never texted. Without the PARTNER check, one
   * Partner's code could verify another's details. Without the DESTINATION
   * check, somebody could request a code to a number they control, change the
   * number on their profile, and verify the new one with the old code.
   *
   * Phone and email verification are gates on withdrawing money, so all three
   * are load-bearing rather than tidy.
   */
  const stored = await peekOtp(id);
  if (!stored) {
    return { ok: false, error: "This code is no longer valid. Please start again." };
  }

  const expectedRaw = which === "email" ? (user.email ?? "") : (p.phone ?? "");
  const mine = otpBelongsToPartner({
    which,
    partnerId: p.id,
    expectedDestination: expectedRaw ? otpDestination(which, expectedRaw) : "",
    stored: {
      purpose: stored.purpose,
      destination: stored.destination,
      payload: (stored.payload ?? null) as Record<string, unknown> | null,
    },
  });

  if (!mine) {
    console.warn(
      `[partners] ${p.code} tried to confirm a code that was not theirs ` +
        `(purpose ${stored.purpose}, which ${which})`,
    );
    // Deliberately the same sentence as a wrong code: this must not become a
    // way to find out which codes exist.
    return { ok: false, error: "This code is no longer valid. Please start again." };
  }

  const res = await verifyOtp(id, code);
  if (!res.ok) return { ok: false, error: res.error };

  await db
    .update(partner)
    .set(
      which === "email"
        ? { emailVerifiedAt: new Date() }
        : { phoneVerifiedAt: new Date() },
    )
    .where(eq(partner.id, p.id));

  revalidatePath("/partner");
  return { ok: true };
}

const phoneSchema = z.object({
  phone: z.string().trim().min(6, "Enter your phone number").max(30),
});

export async function savePartnerPhone(
  input: z.input<typeof phoneSchema>,
): Promise<ActionResult> {
  const { partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  // Stored in the gateway's own spelling (234…), because this is what an
  // OTP's destination is compared against when the code comes back, what the
  // per-number limit counts, and what Termii is handed.
  const phone = otpDestination("phone", parsed.data.phone);
  if (!phone) return { ok: false, error: "That doesn't look like a phone number." };
  // Compared in the same spelling: a number saved before it was stored as
  // 234… still reads "080…" or "+234…", and re-saving it must not clear its
  // verification and cost the Partner another code.
  const stored = p.phone ? otpDestination("phone", p.phone) : null;
  if (phone === stored) {
    if (phone !== p.phone) {
      // Bring the stored spelling into line, keeping the verification.
      await db.update(partner).set({ phone }).where(eq(partner.id, p.id));
      revalidatePath("/partner");
    }
    return { ok: true };
  }

  // Each new number is another number a code can be sent to.
  const limit = rateLimit(
    `partner-phone:${p.id}`,
    PARTNER_OTP_LIMITS.phoneChangesPerDay,
    24 * 60 * 60_000,
  );
  if (!limit.ok) {
    return {
      ok: false,
      error: "Your phone number has been changed too many times today. Try again tomorrow.",
    };
  }

  // Changing the number un-verifies it. A verification that survives the
  // number changing is not a verification.
  await db
    .update(partner)
    .set({ phone, phoneVerifiedAt: null })
    .where(eq(partner.id, p.id));

  revalidatePath("/partner");
  return { ok: true };
}

/* ============================================================
 * Withdrawing
 * ========================================================== */

export async function requestPartnerPayout(input: {
  amount: number;
}): Promise<ActionResult> {
  const { user, partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };

  const [wallet, open, tierNow] = await Promise.all([
    partnerWallet(p.id),
    hasOpenPayout(p.id),
    partnerTierNow(p.id, p.tierOverride),
  ]);

  /*
   * Checked here as well as in the interface, and with the same function —
   * `canWithdraw`, which is pure and tested. The button being disabled is a
   * courtesy; this is the rule.
   */
  const verdict = canWithdraw({
    rates: tierNow.rates,
    available: wallet.available,
    amount: Number(input?.amount),
    status: p.status,
    hasBank: !!(p.bankName && p.bankAccountNumber && p.bankAccountName),
    emailVerified: !!p.emailVerifiedAt,
    phoneVerified: !!p.phoneVerifiedAt,
    openRequest: open,
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const res = await requestPayout({
    partnerId: p.id,
    amount: Number(input.amount),
    bank: {
      name: p.bankName,
      accountNumber: p.bankAccountNumber,
      accountName: p.bankAccountName,
    },
    currency: "NGN",
  });
  if (!res.ok) return res;

  // The recorded figure, not the typed one: whole earnings are taken and any
  // reversal debt is netted in, so the two can differ, and this notice is how
  // the real Partner checks what superadmin is about to transfer.
  console.info(
    `[partners] ${p.code} requested a payout of ${res.amount} (typed ${input.amount}, user ${user.id})`,
  );

  /*
   * Told to the inbox on file, every time. If a session was taken and the
   * account changed, this is the message that lets the real Partner say so
   * before a person in superadmin makes the transfer.
   */
  if (user.email) {
    const where = `${p.bankName} ${maskAccount(p.bankAccountNumber)} (${p.bankAccountName})`;
    const amount = `₦${res.amount.toLocaleString("en-NG")}`;
    try {
      const sent = await sendEmail({
        to: user.email,
        subject: "Your FlockInsight Partner withdrawal request",
        html: emailLayout(
          "Withdrawal requested",
          `A withdrawal of <strong>${escapeHtml(amount)}</strong> to <strong>${escapeHtml(where)}</strong> was requested from your Partner account. We'll pay it once it is approved.<br><br>` +
            `<strong>If this wasn't you</strong>, reset your password now and contact support, quoting your Partner code ${escapeHtml(p.code)}.`,
        ),
        text: `A withdrawal of ${amount} to ${where} was requested from your FlockInsight Partner account. If this wasn't you, reset your password and contact support (code ${p.code}).`,
      });
      if (!sent) console.warn(`[partners] ${p.code}: withdrawal notice email was not accepted`);
    } catch (e) {
      console.error(`[partners] ${p.code}: withdrawal notice email failed`, e);
    }
  }

  revalidatePath("/partner");
  return { ok: true };
}

/* ============================================================
 * Raising a ticket for one of their churches
 * ========================================================== */

const ticketSchema = z.object({
  churchId: z.string().min(1),
  subject: z.string().trim().min(4, "Give it a subject").max(200),
  body: z.string().trim().min(10, "Say what the problem is").max(4000),
});

/**
 * A ticket on behalf of a church the Partner signed.
 *
 * Scoped to THEIR churches: the referral row is read and its partner compared
 * before anything is written, so a Partner cannot open tickets against a
 * church they have nothing to do with. The subject carries their code, because
 * support needs to know they are talking to the agent rather than the pastor —
 * the answer is often different.
 */
export async function raiseTicketForChurch(
  input: z.input<typeof ticketSchema>,
): Promise<ActionResult> {
  const { user, partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };
  if (p.status !== "active") {
    return { ok: false, error: "Your Partner account is not active yet." };
  }

  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const [row] = await db
    .select({ partnerId: partnerReferral.partnerId })
    .from(partnerReferral)
    .where(eq(partnerReferral.churchId, parsed.data.churchId))
    .limit(1);
  if (!row || row.partnerId !== p.id) {
    return { ok: false, error: "That church is not one of yours." };
  }

  const [ticket] = await db
    .insert(supportTicket)
    .values({
      churchId: parsed.data.churchId,
      createdBy: user.id,
      subject: `[Partner ${p.code}] ${parsed.data.subject}`.slice(0, 200),
      category: "partner",
      contactName: p.displayName,
      contactEmail: user.email ?? "",
    })
    .returning({ id: supportTicket.id });

  await db.insert(supportMessage).values({
    ticketId: ticket.id,
    // "church" rather than "support": this is somebody writing IN, and the
    // subject line already says it came from the Partner rather than the pastor.
    authorType: "church",
    authorUserId: user.id,
    authorName: `${p.displayName} (Partner)`,
    body: parsed.data.body,
  });

  revalidatePath("/partner");
  return { ok: true };
}

/* ============================================================
 * Progress emails
 * ========================================================== */

/**
 * Turn the Monday and Thursday progress emails on or off for yourself.
 *
 * The other way back in after following an unsubscribe link: that link stops
 * them with no sign-in, and this — behind the Partner's own session — is the
 * only thing that starts them again. Superadmin can stop them but not restart
 * them; re-subscribing somebody is their decision.
 */
export async function setPartnerDigestOptIn(optIn: boolean): Promise<ActionResult> {
  const { partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };
  await setDigestOptOut(p.id, !optIn);
  revalidatePath("/partner");
  return { ok: true };
}
