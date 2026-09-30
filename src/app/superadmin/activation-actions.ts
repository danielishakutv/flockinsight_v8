"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/platform-settings";
import {
  ENABLED_KEY,
  optOutOfNudges,
  runActivationNudges,
} from "@/lib/activation-nudges";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Turn the automated sequence on or off.
 *
 * A setting rather than an environment variable, so it can be flipped from a
 * phone the moment a reply says the copy reads wrong — which is the only
 * safeguard that matters once mail is actually going out.
 */
export async function setNudgesEnabled(on: boolean): Promise<ActionResult> {
  await requirePlatform("platform.messaging.send");
  await setSetting(ENABLED_KEY, on ? "on" : "off");

  await recordAudit({
    action: "platform.activation.automation",
    severity: on ? "warning" : "info",
    summary: on
      ? "Turned automated activation emails ON"
      : "Turned automated activation emails off",
  });

  revalidateTag("platform-stats", "max");
  revalidatePath("/superadmin");
  return {
    ok: true,
    message: on
      ? "Automation on. The daily run will send the sequence."
      : "Automation off. Nothing will be sent automatically.",
  };
}

/**
 * Send the due sequence now, by hand.
 *
 * `force` deliberately ignores the enabled setting: the point is to send a
 * first round yourself, read the replies, and only then hand it to the cron.
 */
export async function sendNudgesNow(): Promise<ActionResult> {
  await requirePlatform("platform.messaging.send");

  const run = await runActivationNudges({ force: true });
  if (run.planned.length === 0) {
    return { ok: true, message: "Nothing is due — no church is waiting for a step." };
  }

  await recordAudit({
    action: "platform.activation.send",
    severity: "notice",
    summary: `Sent activation emails by hand: ${run.sent} delivered, ${run.failed} failed`,
    meta: { planned: run.planned.length, sent: run.sent, failed: run.failed },
  });

  revalidateTag("platform-stats", "max");
  revalidatePath("/superadmin");
  return {
    ok: true,
    message: `Sent ${run.sent}${run.failed ? `, ${run.failed} failed` : ""}.`,
  };
}

/** Never auto-nudge this church again. */
export async function optOutChurch(churchId: string): Promise<ActionResult> {
  await requirePlatform("platform.messaging.send");
  await optOutOfNudges(churchId);

  await recordAudit({
    action: "platform.activation.optout",
    severity: "info",
    summary: "Excluded a church from automated activation emails",
    targetType: "church",
    targetId: churchId,
  });

  revalidatePath("/superadmin");
  return { ok: true, message: "That church will not be emailed automatically." };
}

/**
 * Whether automation is currently on, for the board.
 *
 * Guarded like every other export here. "use server" makes each one a POST
 * endpoint anyone on the internet can call by name, so an unguarded read is
 * not a read of the board — it is an unauthenticated database query that
 * anybody can run, and it answers a question about how the platform is
 * operated. The answer is dull; being the one endpoint with no check is not.
 */
export async function nudgesEnabled(): Promise<boolean> {
  await requirePlatform("platform.messaging.send");
  return (await getSetting(ENABLED_KEY, "off")) === "on";
}
