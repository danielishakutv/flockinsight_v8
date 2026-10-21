"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActAsChurchId, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import { setChurchAiEnabled } from "@/lib/ai/settings";

/** code names a refusal the page can say in the church's own language. */
export type AiSettingResult =
  | { ok: true }
  | { ok: false; error: string; code?: "onlyOwner" | "actingAs" | "demoOff" };

const Input = z.object({ enabled: z.boolean() }).strict();

/**
 * The church's consent to send aggregate figures to a model. Only the
 * church's OWN owner may give or withdraw it: it is a decision about the
 * church's data, and it belongs to whoever answers for the church.
 */
export async function setChurchAiAction(input: unknown): Promise<AiSettingResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Send { enabled: true } or { enabled: false }." };
  const { enabled } = parsed.data;

  const { church, user } = await requireChurch();
  const access = await getAccess();
  if (!access.isOwner) {
    return { ok: false, code: "onlyOwner", error: "Only the church owner can turn this on or off." };
  }

  // Act-as resolves to isOwner in getAccess, so it has to be refused by name:
  // an administrator cannot consent on a church's behalf.
  if (await getActAsChurchId()) {
    return {
      ok: false,
      code: "actingAs",
      error:
        "Only the church's own owner can give this consent. A FlockInsight administrator cannot turn it on for them.",
    };
  }
  if (church.isDemo) {
    return { ok: false, code: "demoOff", error: "AI summaries are switched off on the demo church." };
  }

  // Turning ON needs the plan; turning OFF is always allowed, whatever the plan.
  if (enabled) {
    const gate = await refuseWithoutFeature("aiSummaries");
    if (gate) return { ok: false, error: gate.error };
  }

  await setChurchAiEnabled(church.id, enabled, user.id);
  await audit({
    churchId: church.id,
    action: enabled ? "settings.ai.grant" : "settings.ai.revoke",
    summary: enabled
      ? "Turned on AI summaries: counts and trends may be sent to Anthropic's Claude"
      : "Turned off AI summaries",
    targetType: "church",
    targetId: church.id,
    meta: { enabled },
  });

  revalidatePath("/settings/ai");
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
  return { ok: true };
}
