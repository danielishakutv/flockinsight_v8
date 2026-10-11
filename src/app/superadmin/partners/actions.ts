"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePlatform } from "@/lib/platform-access";
import { getSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  decidePayout,
  setPartnerRates,
  setPartnerStatus,
} from "@/lib/partners";
import { normaliseRates } from "@/lib/partners-shared";

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

const statusSchema = z.object({
  partnerId: z.string().uuid(),
  status: z.enum(["pending", "active", "suspended"]),
  tierOverride: z.string().trim().max(40).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function savePartnerStatus(
  input: z.input<typeof statusSchema>,
): Promise<ActionResult> {
  await requirePlatform("platform.finance.manage");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  await setPartnerStatus({
    partnerId: parsed.data.partnerId,
    status: parsed.data.status,
    tierOverride: parsed.data.tierOverride ?? null,
    note: parsed.data.note ?? null,
  });

  await recordAudit({
    action: "platform.partner.status",
    summary: `Set a Partner to ${parsed.data.status}${
      parsed.data.tierOverride ? ` (tier ${parsed.data.tierOverride})` : ""
    }`,
    severity: parsed.data.status === "suspended" ? "notice" : "info",
    meta: { partnerId: parsed.data.partnerId },
  });

  revalidatePath("/superadmin/partners");
  return { ok: true };
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
 * back as available rather than destroying them.
 */
export async function decidePartnerPayout(
  input: z.input<typeof decideSchema>,
): Promise<ActionResult> {
  await requirePlatform("platform.finance.manage");
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

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
  if (!res.ok) return res;

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
