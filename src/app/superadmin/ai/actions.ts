"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  AI_CHURCH_SHARE_MAX_USD,
  AI_PLATFORM_CEILING_MAX_USD,
  getAiPlatformState,
  setCeilings,
  setKillSwitch,
  setPausedFeatures,
} from "@/lib/ai/settings";
import { generatePlatformSummary } from "@/lib/ai/summaries";
import type { PlatformSummaryView, UiReason } from "@/lib/ai/ai-shared";

export type AdminResult = { ok: true } | { ok: false; error: string };

const KillInput = z.object({ on: z.boolean() }).strict();

/** Stop (or resume) every AI feature. New calls only: one in flight finishes within its timeout. */
export async function setKillSwitchAction(input: unknown): Promise<AdminResult> {
  await requirePlatform("platform.ai.manage");
  const parsed = KillInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Send { on: true } or { on: false }." };
  await setKillSwitch(parsed.data.on);
  await recordAudit(
    parsed.data.on
      ? { action: "platform.ai.suspend", summary: "Stopped every AI feature (kill switch on)" }
      : { action: "platform.ai.resume", summary: "Resumed AI features (kill switch off)", severity: "critical" },
  );
  revalidatePath("/superadmin/ai");
  return { ok: true };
}

const LimitsInput = z
  .object({
    platformUsd: z.number().min(0).max(AI_PLATFORM_CEILING_MAX_USD),
    churchUsd: z.number().min(0).max(AI_CHURCH_SHARE_MAX_USD),
    paused: z.array(z.enum(["analytics", "chat", "blog"])),
  })
  .strict();

/** The monthly ceilings (the $20 hard stop is in code) and per-feature pauses. */
export async function saveAiLimitsAction(input: unknown): Promise<AdminResult> {
  await requirePlatform("platform.ai.manage");
  const parsed = LimitsInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `The platform ceiling must be $0–$${AI_PLATFORM_CEILING_MAX_USD} and each church's share $0–$${AI_CHURCH_SHARE_MAX_USD}.`,
    };
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const after = {
    platformUsd: round(parsed.data.platformUsd),
    churchUsd: round(parsed.data.churchUsd),
    paused: [...new Set(parsed.data.paused)],
  };
  const s = await getAiPlatformState();
  const before = { platformUsd: s.platformCeilingUsd, churchUsd: s.churchShareUsd, paused: s.pausedFeatures };

  await setCeilings({ platformUsd: after.platformUsd, churchUsd: after.churchUsd });
  await setPausedFeatures(after.paused);
  await recordAudit({
    action: "platform.ai.update",
    summary: "Changed AI ceilings or paused features",
    meta: { before, after },
  });
  revalidatePath("/superadmin/ai");
  return { ok: true };
}

export type PlatformSummaryResult =
  | { ok: true; view: PlatformSummaryView }
  | { ok: false; reason?: UiReason; error: string };

/** The operator's own briefing. One per day, by the same claim as a church's. */
export async function generatePlatformSummaryAction(): Promise<PlatformSummaryResult> {
  const access = await requirePlatform("platform.overview.view");
  const rl = rateLimit(`ai-platform:${access.id}`, 5, 60_000);
  if (!rl.ok) return { ok: false, reason: "too_fast", error: `Too many tries. Wait ${rl.retryAfterSec} s.` };
  const res = await generatePlatformSummary(access.id);
  revalidatePath("/superadmin");
  return res.ok ? { ok: true, view: res.view } : { ok: false, reason: res.reason, error: res.message };
}
