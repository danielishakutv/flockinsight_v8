"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { aiChurchSetting, church } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  AI_CHURCH_SHARE_MAX_USD,
  AI_PLATFORM_CEILING_MAX_USD,
  getAdvisorPilot,
  getAdvisorRollout,
  getAiPlatformState,
  getAssistantAllowances,
  setAdvisorPilot,
  setAdvisorRollout,
  setAssistantAllowances,
  setCeilings,
  setChurchShareByPlan,
  setKillSwitch,
  setPausedFeatures,
} from "@/lib/ai/settings";
import { ALLOWANCE_MAX } from "@/lib/ai/settings-rules";
import { churchRowHasFeature } from "@/lib/entitlements";
import { loadCatalog } from "@/lib/plan-catalog";
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

const share = z.number().min(0).max(AI_CHURCH_SHARE_MAX_USD);

const LimitsInput = z
  .object({
    platformUsd: z.number().min(0).max(AI_PLATFORM_CEILING_MAX_USD),
    // Each church's monthly money by its plan. The old single share is no
    // longer read for churches, so it is no longer edited here.
    churchShareByPlan: z.object({ starter: share, growth: share, pro: share, enterprise: share }).strict(),
    paused: z.array(z.enum(["analytics", "chat", "blog", "advisor"])),
  })
  .strict();

/** The monthly ceilings (the $20 hard stop is in code), each plan's church share, and per-feature pauses. */
export async function saveAiLimitsAction(input: unknown): Promise<AdminResult> {
  await requirePlatform("platform.ai.manage");
  const parsed = LimitsInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `The platform ceiling must be $0–$${AI_PLATFORM_CEILING_MAX_USD} and each plan's church share $0–$${AI_CHURCH_SHARE_MAX_USD}.`,
    };
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const s = await getAiPlatformState();
  const before = {
    platformUsd: s.platformCeilingUsd,
    churchShareByPlan: s.churchShareByPlanUsd,
    paused: s.pausedFeatures,
  };

  // The legacy single share is written back unchanged: setCeilings takes both.
  await setCeilings({ platformUsd: round(parsed.data.platformUsd), churchUsd: s.churchShareUsd });
  const churchShareByPlan = await setChurchShareByPlan(parsed.data.churchShareByPlan);
  const paused = [...new Set(parsed.data.paused)];
  await setPausedFeatures(paused);
  const after = { platformUsd: round(parsed.data.platformUsd), churchShareByPlan, paused };

  await recordAudit({
    action: "platform.ai.update",
    summary: "Changed AI ceilings, plan shares or paused features",
    meta: { before, after },
  });
  revalidatePath("/superadmin/ai");
  return { ok: true };
}

/*
 * The assistant's question allowances. A plan may be null (no ceiling, sent
 * as an empty box); the per-person day never may. Whole numbers only, the
 * same bounds settings-rules.ts reads back, so what is saved is what runs.
 */
const allowance = z.number().int().min(0).max(ALLOWANCE_MAX);
const AllowancesInput = z
  .object({
    starter: allowance.nullable(),
    growth: allowance.nullable(),
    pro: allowance.nullable(),
    enterprise: allowance.nullable(),
    perPersonDaily: allowance,
  })
  .strict();

export async function saveAssistantAllowancesAction(input: unknown): Promise<AdminResult> {
  await requirePlatform("platform.ai.manage");
  const parsed = AllowancesInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Each allowance must be a whole number from 0 to ${ALLOWANCE_MAX.toLocaleString("en")}. Leave a plan empty for no monthly limit; the daily limit per person cannot be empty.`,
    };
  }
  const before = await getAssistantAllowances();
  if (!(await setAssistantAllowances(parsed.data))) {
    return { ok: false, error: "Those allowances could not be saved. Check each number and try again." };
  }
  await recordAudit({
    action: "platform.ai.update",
    summary: "Changed the assistant's question allowances",
    meta: { setting: "assistant_allowances", before, after: parsed.data },
  });
  revalidatePath("/superadmin/ai");
  return { ok: true };
}

const RolloutInput = z
  .object({
    rollout: z.enum(["off", "pilot", "all"]),
    pilot: z.array(z.string().trim().min(1).max(100)).max(200),
  })
  .strict();

const ROLLOUT_LABEL = { off: "Off", pilot: "Pilot churches", all: "Every eligible church" } as const;

/**
 * Who gets the church advisor. The pilot list is saved first and refused as
 * a whole if any entry is not a church address, so a bad list never leaves
 * the rollout pointing at half of it.
 */
export async function saveAdvisorRolloutAction(input: unknown): Promise<AdminResult> {
  await requirePlatform("platform.ai.manage");
  const parsed = RolloutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick Off, Pilot churches or Every eligible church." };
  const [beforeRollout, beforePilot] = await Promise.all([getAdvisorRollout(), getAdvisorPilot()]);

  const pilot = await setAdvisorPilot(parsed.data.pilot);
  if (!pilot) {
    return {
      ok: false,
      error: "A pilot entry is not a church address (lowercase letters, digits and hyphens). Nothing was saved.",
    };
  }
  await setAdvisorRollout(parsed.data.rollout);

  await recordAudit({
    action: "platform.ai.update",
    summary: `Changed the church advisor rollout: ${ROLLOUT_LABEL[parsed.data.rollout]}${
      parsed.data.rollout === "pilot" ? ` (${pilot.length} church${pilot.length === 1 ? "" : "es"})` : ""
    }`,
    meta: {
      setting: "assistant_advisor_rollout",
      before: { rollout: beforeRollout, pilot: beforePilot },
      after: { rollout: parsed.data.rollout, pilot },
    },
  });
  revalidatePath("/superadmin/ai");
  return { ok: true };
}

/** A church as the pilot editor shows it: enough to judge whether the advisor could work there. */
export type PilotChurch = {
  slug: string;
  /** Null when no church has this address (deleted, or a typo saved before). */
  name: string | null;
  plan: string | null;
  /** The owner has turned AI features on. Without it the advisor never answers there. */
  aiOn: boolean;
  /** The plan includes the church advisor (Growth and above). */
  advisorOnPlan: boolean;
  isDemo: boolean;
};

export type PilotSearchResult = { ok: true; churches: PilotChurch[] } | { ok: false; error: string };

/** Churches by name or address, for adding to the pilot. Ten at most. */
export async function searchPilotChurchesAction(input: unknown): Promise<PilotSearchResult> {
  const admin = await requirePlatform("platform.ai.manage");
  const parsed = z.object({ q: z.string().trim().min(2).max(80) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Type at least two letters of the church's name." };
  const rl = rateLimit(`ai-pilot-search:${admin.id}`, 60, 60_000);
  if (!rl.ok) return { ok: false, error: `Too many searches. Wait ${rl.retryAfterSec} s.` };

  const like = `%${parsed.data.q.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = await db
    .select({
      slug: church.slug,
      name: church.name,
      plan: church.plan,
      customPlanId: church.customPlanId,
      isDemo: church.isDemo,
      aiOn: aiChurchSetting.enabled,
    })
    .from(church)
    .leftJoin(aiChurchSetting, eq(aiChurchSetting.churchId, church.id))
    .where(or(ilike(church.name, like), ilike(church.slug, like)))
    .orderBy(church.name)
    .limit(10);
  const catalog = await loadCatalog();
  return {
    ok: true,
    churches: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      plan: r.plan,
      aiOn: r.aiOn === true,
      // churchRowHasFeature treats the demo church as Enterprise; the advisor never answers there.
      advisorOnPlan: !r.isDemo && churchRowHasFeature(r, "aiAdvisor", catalog),
      isDemo: r.isDemo,
    })),
  };
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
