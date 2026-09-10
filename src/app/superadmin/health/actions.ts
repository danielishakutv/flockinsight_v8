"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { snapshotTermiiBalance } from "@/lib/termii-balance";
import { emailLayout, emailProvider, sendEmail } from "@/lib/mailer";
import { recordAudit } from "@/lib/audit";
import {
  setSetting,
  TERMII_UNIT_COST_KEY,
  TERMII_UNIT_COST_MODE_KEY,
} from "@/lib/platform-settings";

/** Take a fresh Termii reading and drop the cached float. */
export async function refreshFloat(): Promise<void> {
  await requireSuperAdmin();
  await snapshotTermiiBalance();
  // updateTag expires immediately, which is what a manual Refresh should do.
  updateTag("float");
  revalidatePath("/superadmin/health");
}

export async function saveUnitCost(
  value: string,
  mode: "manual" | "auto",
): Promise<{ ok: boolean; error?: string }> {
  await requireSuperAdmin();

  const trimmed = value.trim();
  if (mode === "manual") {
    if (!trimmed) return { ok: false, error: "Enter a cost per page." };
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: "Cost must be a number greater than zero." };
    }
    await setSetting(TERMII_UNIT_COST_KEY, String(n));
  }

  await setSetting(TERMII_UNIT_COST_MODE_KEY, mode);
  updateTag("float");
  revalidatePath("/superadmin/health");
  return { ok: true };
}

/**
 * Send one real email through whichever provider is live.
 *
 * The only honest way to know a mail provider works is to make it carry a
 * message and then look in the inbox. Configuration checks prove a key is
 * present, not that a domain is verified, that the From address is accepted,
 * or that the message survives a spam filter — and each of those has broken a
 * send here before.
 */
export async function sendProviderTestEmail(
  to: string,
): Promise<{ ok: true; provider: string } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin();

  const address = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  const provider = emailProvider();
  if (provider === "none") {
    return { ok: false, error: "No email provider is configured." };
  }

  const when = new Date().toISOString();
  const ok = await sendEmail({
    to: address,
    subject: `FlockInsight test — ${provider}`,
    html: emailLayout(
      "Email is working",
      `<p>This is a test from the platform health page.</p>
       <p><strong>Provider:</strong> ${provider}<br/>
          <strong>Sent:</strong> ${when}<br/>
          <strong>Requested by:</strong> ${admin.email}</p>
       <p>If this arrived in the inbox rather than spam, the domain, the From
          address and the provider are all working.</p>`,
    ),
    text: `FlockInsight test via ${provider} at ${when}, requested by ${admin.email}.`,
  });

  if (!ok) {
    return {
      ok: false,
      error: `${provider} refused the message. The reason is in the server logs.`,
    };
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "email_test",
    summary: `Sent a test email to ${address} via ${provider}`,
  });

  return { ok: true, provider };
}
