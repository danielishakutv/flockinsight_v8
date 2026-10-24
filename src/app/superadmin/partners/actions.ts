"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { partner, partnerPayout, user } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { getSession } from "@/lib/session";
import { recordAudit, summariseChanges } from "@/lib/audit";
import {
  decidePayout,
  setPartnerBankByAdmin,
  setPartnerRates,
  setPartnerStatus,
  setPartnerVerification,
  updatePartnerProfile,
} from "@/lib/partners";
import { maskAccount, normaliseRates } from "@/lib/partners-shared";
import { deliverStatusEmail, notifyBankChanged } from "@/lib/partner-notices";
import {
  sendPartnerDigest,
  setDigestOptOut,
  setPartnerDigestEnabled,
} from "@/lib/partner-digest";
import { digestSlotIndex } from "@/lib/partner-digest-shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The platform side of the Partner programme.
 *
 * Everything here moves or promises money, so all of it sits behind
 * `platform.finance.manage` — the permission that already means "move money" —
 * rather than a new key nobody has been granted yet. And all of it is audited,
 * because a rate change and a payout are both things somebody will later need
 * to ask "who did that, and when".
 */

const ratesSchema = z.object({
  tiers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        minChurches: z.number().int().min(0).max(100_000),
        firstBps: z.number().int().min(0).max(10_000),
        secondBps: z.number().int().min(0).max(10_000),
      }),
    )
    .min(1, "Keep at least one tier"),
  trailBps: z.number().int().min(0).max(10_000),
  trailMonths: z.number().int().min(0).max(120),
  minPayout: z.number().int().min(0).max(100_000_000),
  tierWindowDays: z.number().int().min(1).max(3650),
});

export async function savePartnerRates(
  input: z.input<typeof ratesSchema>,
): Promise<ActionResult> {
  await requirePlatform("platform.finance.manage");
  const parsed = ratesSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  // Normalised again on the way in: the schema bounds each number, this sorts
  // the ladder so the tier search stays monotonic.
  const clean = normaliseRates(parsed.data);
  await setPartnerRates(clean);

  await recordAudit({
    action: "platform.partner.rates",
    summary: `Set Partner rates: ${clean.tiers
      .map((t) => `${t.name} ${t.firstBps / 100}%`)
      .join(", ")}; trail ${clean.trailBps / 100}% for ${clean.trailMonths}m`,
    severity: "notice",
    meta: clean as unknown as Record<string, unknown>,
  });

  revalidatePath("/superadmin/partners");
  return { ok: true };
}

/** Who a Partner is, for the audit label and for telling them. */
async function partnerContact(partnerId: string) {
  const [row] = await db
    .select({
      id: partner.id,
      userId: partner.userId,
      code: partner.code,
      displayName: partner.displayName,
      phone: partner.phone,
      phoneVerifiedAt: partner.phoneVerifiedAt,
      email: user.email,
    })
    .from(partner)
    .innerJoin(user, eq(user.id, partner.userId))
    .where(eq(partner.id, partnerId))
    .limit(1);
  return row ?? null;
}

/**
 * Nobody manages their own Partner account.
 *
 * An admin can be a Partner too, and every lever on this page is worth money
 * to the Partner it is pulled for: a tier set by hand raises their commission
 * rate, vouching for their phone opens withdrawals, a payout account decides
 * where the money goes, and approving a withdrawal is the step before paying
 * it. Those decisions are made by somebody else.
 */
const OWN_ACCOUNT =
  "That is your own Partner account — another admin has to make this change.";

function revalidatePartner(partnerId: string) {
  revalidatePath("/superadmin/partners");
  revalidatePath(`/superadmin/partners/${partnerId}`);
}

const statusSchema = z.object({
  partnerId: z.string().uuid(),
  status: z.enum(["pending", "active", "paused", "suspended"]),
  /** Shown to the Partner. Only kept for paused and suspended. */
  reason: z.string().trim().max(500).optional(),
});

/**
 * `emailed` is null when the status did not change (a reworded reason), so
 * there was nothing to send; false means the send failed and is being retried.
 */
export type StatusResult =
  | { ok: true; emailed: boolean | null }
  | { ok: false; error: string };

/**
 * Approve, pause, resume, suspend or reinstate a Partner.
 *
 * Pause and suspend differ in what they COST the Partner, which is why both
 * exist: a pause holds withdrawals while commission keeps being recorded, a
 * suspension stops commission being awarded at all (`awardPartnerCommission`
 * refuses a suspended Partner). See PARTNER_STATUS_EFFECT.
 *
 * EVERY status change is emailed to the Partner — there is no "don't tell
 * them" option. A send that fails is retried hourly by the partner-emails job
 * (`statusNotifiedAt` stays behind `statusChangedAt` until one is accepted),
 * and a change still untold after a day raises a platform alert.
 *
 * Neither touches open withdrawal requests. They stay in the queue, marked
 * with the Partner's status, because a transfer that has already been made
 * must still be recordable as paid — refusing it would leave the ledger
 * disagreeing with the bank.
 */
export async function savePartnerStatus(
  input: z.input<typeof statusSchema>,
): Promise<StatusResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { partnerId, status, reason } = parsed.data;

  const who = await partnerContact(partnerId);
  if (!who) return { ok: false, error: "That Partner no longer exists." };
  if (who.userId === admin.id) return { ok: false, error: OWN_ACCOUNT };

  const res = await setPartnerStatus({ partnerId, status, reason: reason ?? null });
  if (!res.ok) return res;

  await recordAudit({
    action: "platform.partner.status",
    summary: res.changed
      ? `${who.displayName} (${who.code}): ${res.before} → ${status}${reason ? ` — ${reason}` : ""}`
      : `${who.displayName} (${who.code}): updated the ${status} reason`,
    severity: status === "suspended" || status === "paused" ? "notice" : "info",
    targetType: "partner",
    targetId: partnerId,
    targetLabel: who.displayName,
    meta: { partnerId, from: res.before, to: status },
  });

  const emailed = res.changed ? (await deliverStatusEmail(partnerId)) === "sent" : null;

  revalidatePartner(partnerId);
  return { ok: true, emailed };
}

const profileSchema = z.object({
  partnerId: z.string().uuid(),
  displayName: z.string().trim().min(2, "Give them a name").max(120),
  phone: z.string().trim().max(30).optional(),
  tierOverride: z.string().trim().max(40).optional(),
  note: z.string().trim().max(2000).optional(),
});

/** Name, phone, tier override and the internal note. */
export async function savePartnerProfile(
  input: z.input<typeof profileSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const who = await partnerContact(parsed.data.partnerId);
  if (!who) return { ok: false, error: "That Partner no longer exists." };
  if (who.userId === admin.id) return { ok: false, error: OWN_ACCOUNT };

  const res = await updatePartnerProfile({
    partnerId: parsed.data.partnerId,
    displayName: parsed.data.displayName,
    phone: parsed.data.phone || null,
    tierOverride: parsed.data.tierOverride || null,
    note: parsed.data.note || null,
  });
  if (!res.ok) return res;

  if (Object.keys(res.changed).length) {
    await recordAudit({
      action: "platform.partner.update",
      summary: `Updated ${parsed.data.displayName}'s Partner ${summariseChanges(res.changed, {
        displayName: "name",
        tierOverride: "tier override",
      })}${res.changed.phone ? " (phone needs verifying again)" : ""}`,
      targetType: "partner",
      targetId: parsed.data.partnerId,
      targetLabel: parsed.data.displayName,
      // A tier override changes what they are paid, so it is worth noticing.
      severity: res.changed.tierOverride ? "notice" : "info",
      meta: { partnerId: parsed.data.partnerId, changed: res.changed },
    });
  }

  revalidatePartner(parsed.data.partnerId);
  return { ok: true };
}

const verificationSchema = z.object({
  partnerId: z.string().uuid(),
  which: z.enum(["email", "phone"]),
  verified: z.boolean(),
});

/**
 * Vouch for a Partner's email or phone, or take the verification back.
 *
 * Both are gates on withdrawing, so vouching is recorded as worth noticing —
 * it is a person standing in for the code that would otherwise prove it.
 */
export async function savePartnerVerification(
  input: z.input<typeof verificationSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = verificationSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { partnerId, which, verified } = parsed.data;

  const who = await partnerContact(partnerId);
  if (!who) return { ok: false, error: "That Partner no longer exists." };
  if (who.userId === admin.id) return { ok: false, error: OWN_ACCOUNT };

  const res = await setPartnerVerification({ partnerId, which, verified });
  if (!res.ok) return res;

  await recordAudit({
    action: "platform.partner.verification",
    summary: verified
      ? `Marked ${who.displayName}'s ${which} as verified by hand (${which === "email" ? who.email : who.phone})`
      : `Cleared ${who.displayName}'s ${which} verification`,
    severity: "notice",
    targetType: "partner",
    targetId: partnerId,
    targetLabel: who.displayName,
    meta: { partnerId, which, verified },
  });

  revalidatePartner(partnerId);
  return { ok: true };
}

const adminBankSchema = z.object({
  partnerId: z.string().uuid(),
  bankName: z.string().trim().min(2, "Which bank?").max(80),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "An account number is digits only"),
  bankAccountName: z.string().trim().min(2, "The name on the account").max(120),
});

export type BankByAdminResult =
  | { ok: true; changed: boolean; emailed: boolean; texted: boolean | null }
  | { ok: false; error: string };

/**
 * Correct where a Partner is paid — usually because they wrote in from their
 * inbox and asked. They are told, by email and by text to a verified number,
 * whatever the reason: see `setPartnerBankByAdmin`.
 */
export async function savePartnerBankByAdmin(
  input: z.input<typeof adminBankSchema>,
): Promise<BankByAdminResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = adminBankSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { partnerId, ...bank } = parsed.data;

  const who = await partnerContact(partnerId);
  if (!who) return { ok: false, error: "That Partner no longer exists." };
  if (who.userId === admin.id) return { ok: false, error: OWN_ACCOUNT };

  const res = await setPartnerBankByAdmin({ partnerId, bank });
  if (!res.ok) return res;
  if (!res.changed) {
    // A spelling correction to the same account: saved, nobody to warn.
    revalidatePartner(partnerId);
    return { ok: true, changed: false, emailed: false, texted: null };
  }

  await recordAudit({
    action: "platform.partner.bank",
    summary: `Set ${who.displayName}'s payout account to ${bank.bankName} ${maskAccount(bank.bankAccountNumber)}`,
    // Where money goes: the row someone scanning the log is looking for.
    severity: "warning",
    targetType: "partner",
    targetId: partnerId,
    targetLabel: who.displayName,
    meta: { partnerId, bankName: bank.bankName, account: maskAccount(bank.bankAccountNumber) },
  });

  const told = await notifyBankChanged({
    email: who.email,
    phone: who.phoneVerifiedAt ? who.phone : null,
    code: who.code,
    displayName: who.displayName,
    bank,
    hadAccount: res.hadAccount,
    reverify: false,
    by: "support",
  });

  revalidatePartner(partnerId);
  return { ok: true, changed: true, ...told };
}

const decideSchema = z.object({
  payoutId: z.string().uuid(),
  status: z.enum(["approved", "paid", "rejected"]),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Approve, mark paid, or reject a withdrawal.
 *
 * Nothing here sends money — a human makes the transfer and records it against
 * the request. That is deliberate for a programme on its first night: wiring an
 * automatic bank transfer to a table anybody can insert into is a decision that
 * deserves its own week.
 *
 * Marking it PAID is what moves the earnings to paid. REJECTING hands them
 * back as available rather than destroying them. Paid or rejected is final —
 * `decidePayout` holds that under a row lock (PAYOUT_TRANSITIONS in
 * lib/partners-shared.ts), and the partner_payout_final trigger holds it again
 * in the database.
 */
export async function decidePartnerPayout(
  input: z.input<typeof decideSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  // Your own withdrawal is decided by somebody else — see OWN_ACCOUNT.
  const [owner] = await db
    .select({ userId: partner.userId })
    .from(partnerPayout)
    .innerJoin(partner, eq(partner.id, partnerPayout.partnerId))
    .where(eq(partnerPayout.id, parsed.data.payoutId))
    .limit(1);
  if (owner?.userId === admin.id) return { ok: false, error: OWN_ACCOUNT };

  if (parsed.data.status === "paid" && !parsed.data.reference?.trim()) {
    return {
      ok: false,
      error: "Add the transfer reference, so this can be reconciled later.",
    };
  }

  const session = await getSession();
  const res = await decidePayout({
    payoutId: parsed.data.payoutId,
    status: parsed.data.status,
    reference: parsed.data.reference ?? null,
    note: parsed.data.note ?? null,
    decidedBy: session?.user?.id ?? null,
  });
  if (!res.ok) {
    // Refused because the request moved under a stale page (someone else
    // decided it). Re-render the queue with it,
    // so the next click is made against what is really there.
    revalidatePath("/superadmin/partners");
    return res;
  }

  await recordAudit({
    action: "platform.partner.payout",
    summary: `Partner withdrawal marked ${parsed.data.status}${
      parsed.data.reference ? ` (${parsed.data.reference})` : ""
    }`,
    severity: "notice",
    meta: { payoutId: parsed.data.payoutId },
  });

  revalidatePath("/superadmin/partners");
  return { ok: true };
}

/* ============================================================
 * Partner emails
 * ========================================================== */

/** The switch for every Partner's Monday and Thursday progress email. */
export async function savePartnerDigestEnabled(on: boolean): Promise<ActionResult> {
  await requirePlatform("platform.finance.manage");
  await setPartnerDigestEnabled(!!on);
  await recordAudit({
    action: "platform.partner.digest",
    summary: on
      ? "Turned the Partners' twice-weekly progress emails on"
      : "Turned the Partners' twice-weekly progress emails off",
    severity: "notice",
  });
  revalidatePath("/superadmin/partners");
  return { ok: true };
}

/**
 * Stop one Partner's progress emails — when they ask by phone or in a reply.
 * There is deliberately no matching "start": putting somebody back on a list
 * they left is their decision, made from their own Partner page.
 */
export async function stopPartnerDigest(partnerId: string): Promise<ActionResult> {
  await requirePlatform("platform.finance.manage");
  if (!z.string().uuid().safeParse(partnerId).success) return { ok: false, error: "Invalid id" };
  const who = await partnerContact(partnerId);
  if (!who) return { ok: false, error: "That Partner no longer exists." };
  const changed = await setDigestOptOut(partnerId, true);
  if (changed) {
    await recordAudit({
      action: "platform.partner.digest",
      summary: `Stopped ${who.displayName}'s progress emails`,
      targetType: "partner",
      targetId: partnerId,
      targetLabel: who.displayName,
    });
  }
  revalidatePartner(partnerId);
  return { ok: true };
}

export type DigestNowResult =
  | { ok: true; subject: string; segment: string }
  | { ok: false; error: string };

/**
 * Send one Partner their progress email now, outside the schedule.
 *
 * For seeing exactly what a Partner will read, and for a Partner who asks
 * "where are my numbers?". Recorded under its own `manual:` slot, so it never
 * uses up the scheduled send day. Refused for a Partner who opted out or is
 * paused or suspended — the same people the schedule leaves alone.
 */
export async function sendPartnerDigestNow(partnerId: string): Promise<DigestNowResult> {
  await requirePlatform("platform.finance.manage");
  if (!z.string().uuid().safeParse(partnerId).success) return { ok: false, error: "Invalid id" };
  const [p] = await db
    .select({
      displayName: partner.displayName,
      status: partner.status,
      optOut: partner.digestOptOutAt,
    })
    .from(partner)
    .where(eq(partner.id, partnerId))
    .limit(1);
  if (!p) return { ok: false, error: "That Partner no longer exists." };
  if (p.optOut) return { ok: false, error: "They turned these emails off." };
  if (p.status === "paused" || p.status === "suspended") {
    return {
      ok: false,
      error: `They are ${p.status}. Progress emails go to active and pending Partners.`,
    };
  }

  const now = new Date();
  const today = new Date(now.getTime() + 60 * 60_000).toISOString().slice(0, 10);
  const res = await sendPartnerDigest({
    partnerId,
    slot: `manual:${now.toISOString()}`,
    slotIndex: digestSlotIndex(today),
    now,
  });
  if (res.outcome === "skipped") return { ok: false, error: `Not sent: ${res.reason}.` };
  if (res.outcome === "failed") return { ok: false, error: `The email was not accepted: ${res.error}` };

  await recordAudit({
    action: "platform.partner.digest",
    summary: `Sent ${p.displayName} their progress email by hand ("${res.subject}")`,
    targetType: "partner",
    targetId: partnerId,
    targetLabel: p.displayName,
  });
  revalidatePartner(partnerId);
  return { ok: true, subject: res.subject, segment: res.segment };
}
