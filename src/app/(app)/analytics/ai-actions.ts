"use server";

import { revalidatePath } from "next/cache";
import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { rateLimit } from "@/lib/rate-limit";
import { generateChurchSummary } from "@/lib/ai/summaries";
import { canReadChurchSummary, type ChurchSummaryView, type UiReason } from "@/lib/ai/ai-shared";

export type SummaryActionResult =
  | { ok: true; view: ChurchSummaryView }
  | { ok: false; reason?: UiReason; error: string; view?: ChurchSummaryView };

/**
 * Write today's plain-language summary for the signed-in church. Takes no
 * input: the church always comes from the session, never from the request.
 */
export async function generateChurchSummaryAction(): Promise<SummaryActionResult> {
  const { church, user } = await requireChurch();

  if (!canReadChurchSummary(await getAccess())) {
    return {
      ok: false,
      reason: "role_too_narrow",
      error: "Your role does not include the giving and follow-up figures this summary describes.",
    };
  }

  const gate = await refuseWithoutFeature("aiSummaries");
  if (gate) return { ok: false, error: gate.error };

  // Guards the endpoint against scripted hammering; the one-per-day claim is
  // what really limits spending.
  const rl = rateLimit(`ai-summary:${user.id}`, 5, 60_000);
  if (!rl.ok) {
    return { ok: false, reason: "too_fast", error: `Too many tries. Wait ${rl.retryAfterSec} s and try again.` };
  }

  const result = await generateChurchSummary(church.id, user.id);
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
  if (result.ok) return { ok: true, view: result.view };
  return { ok: false, reason: result.reason, error: result.message, view: result.view };
}
