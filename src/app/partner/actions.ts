"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { partner, partnerReferral, supportMessage, supportTicket } from "@/db/schema";
import { requireUser } from "@/lib/session";
import {
  createPartner,
  hasOpenPayout,
  partnerForUser,
  partnerTierNow,
  partnerWallet,
  requestPayout,
} from "@/lib/partners";
import { canWithdraw } from "@/lib/partners-shared";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { emailLayout, sendEmail } from "@/lib/mailer";
import { sendSms } from "@/lib/sms";

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

export async function applyToBePartner(
  input: z.input<typeof joinSchema>,
): Promise<ActionResult> {
  const { user } = await requireUser();
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await createPartner({
    userId: user.id,
    displayName: parsed.data.displayName,
    phone: parsed.data.phone ?? null,
  });
  if (!res.ok) return res;

  revalidatePath("/partner");
  return { ok: true };
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

export async function savePartnerBank(
  input: z.input<typeof bankSchema>,
): Promise<ActionResult> {
  const { partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };

  const parsed = bankSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  await db
    .update(partner)
    .set({
      bankName: parsed.data.bankName,
      bankAccountNumber: parsed.data.bankAccountNumber,
      bankAccountName: parsed.data.bankAccountName,
    })
    .where(eq(partner.id, p.id));

  revalidatePath("/partner");
  return { ok: true };
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

  const destination = which === "email" ? (user.email ?? "") : (p.phone ?? "");
  if (!destination) {
    return {
      ok: false,
      error:
        which === "phone"
          ? "Add your phone number first."
          : "Your account has no email address.",
    };
  }

  const issued = await issueOtp({
    // No church: a Partner is a person, not a congregation.
    churchId: null,
    destination,
    channel: which === "email" ? "email" : "sms",
    purpose: `partner_${which}`,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  /*
   * `issueOtp` stores the code and hands back the plaintext for the caller to
   * deliver — so delivery is this function's job, and a code that was stored
   * but never sent would be a form that can never be completed.
   *
   * The SMS goes through the platform's own Termii credentials rather than a
   * church's wallet, because there is no church here to charge. That is a real
   * cost on us per Partner, which is one more reason the programme is applied
   * for and approved rather than open to anybody.
   */
  const sent =
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
          .then(() => true)
          .catch(() => false)
      : await sendSms({
          to: destination,
          message: `Your FlockInsight Partner verification code is ${issued.code}.`,
        }).then((r) => r.ok);

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

export async function confirmPartnerOtp(input: {
  which: "email" | "phone";
  id: string;
  code: string;
}): Promise<ActionResult> {
  const { partner: p } = await me();
  if (!p) return { ok: false, error: "You are not a Partner." };
  if (typeof input?.id !== "string" || typeof input?.code !== "string") {
    return { ok: false, error: "Invalid" };
  }

  const res = await verifyOtp(input.id, input.code);
  if (!res.ok) return { ok: false, error: res.error };

  await db
    .update(partner)
    .set(
      input.which === "email"
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

  // Changing the number un-verifies it. A verification that survives the
  // number changing is not a verification.
  await db
    .update(partner)
    .set({ phone: parsed.data.phone, phoneVerifiedAt: null })
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

  console.info(
    `[partners] ${p.code} requested a payout of ${input.amount} (user ${user.id})`,
  );
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
