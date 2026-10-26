import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiChurchSetting, church, user, type AiFeature } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/platform-settings";
import { churchRowHasFeature } from "@/lib/entitlements";
import type { PlanId } from "@/lib/plans";
import { CHURCH_NOTES_MAX } from "@/lib/assistant/advisor-shared";
import { aiConfigured } from "./config";
import { usdToNano } from "./budget-rules";
import {
  ADVISOR_PILOT_DEFAULT,
  ADVISOR_ROLLOUT_DEFAULT,
  AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD,
  AI_CHURCH_SHARE_MAX_USD,
  normaliseAdvisorPilot,
  normaliseChurchShareByPlan,
  parseAdvisorPilot,
  parseAdvisorRollout,
  parseAssistantAllowances,
  parseChurchShareByPlan,
  validateAssistantAllowances,
  type AdvisorRollout,
  type AssistantAllowances,
} from "./settings-rules";

export { AI_CHURCH_SHARE_MAX_USD };
export type { AdvisorRollout, AssistantAllowances };

/* ------------------------------------------------------------------ *
 * Platform controls, in platform_setting
 * ------------------------------------------------------------------ */

/** "on" = every AI feature stopped. Default "off". */
export const AI_KILL_KEY = "ai_kill_switch";
/** Monthly platform ceiling in USD. Default "20", clamped to 0..AI_PLATFORM_CEILING_MAX_USD. */
export const AI_PLATFORM_CEILING_KEY = "ai_platform_monthly_usd";
/**
 * The old single church share in USD. No longer read for churches: runAi
 * charges each church its plan's share (AI_CHURCH_SHARE_BY_PLAN_KEY). Kept so
 * the stored value and the setter still mean something until the superadmin
 * control moves to the four plan shares.
 */
export const AI_CHURCH_SHARE_KEY = "ai_church_monthly_usd";
/** JSON `{ starter, growth, pro, enterprise }` in USD, each clamped to 0..AI_CHURCH_SHARE_MAX_USD. */
export const AI_CHURCH_SHARE_BY_PLAN_KEY = "ai_church_share_by_plan";
/** JSON array of AiFeature. Default "[]". */
export const AI_PAUSED_FEATURES_KEY = "ai_paused_features";

/**
 * The hard stop. It cannot be raised from the UI: raising it is a code change,
 * which is the owner's decision, not a setting an operator can drift past.
 */
export const AI_PLATFORM_CEILING_MAX_USD = 20;
export const AI_PLATFORM_CEILING_DEFAULT_USD = 20;
export const AI_CHURCH_SHARE_DEFAULT_USD = 0.5;

export const AI_FEATURES: readonly AiFeature[] = ["analytics", "chat", "blog", "advisor"];

export type AiPlatformState = {
  configured: boolean;
  killed: boolean;
  pausedFeatures: AiFeature[];
  platformCeilingNano: number;
  churchShareNano: number;
  platformCeilingUsd: number;
  /** The legacy single share. Not used for churches any more; see churchShareByPlanUsd. */
  churchShareUsd: number;
  /** What runAi reserves a church's calls against, by that church's plan. */
  churchShareByPlanUsd: Record<PlanId, number>;
};

/*
 * A setting that cannot be read is logged once per process, not on every
 * call: the assistant reads these on every question, and a log line per
 * question would bury the one that matters.
 */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[ai] ${key} could not be read; ${message}`);
}

function clampUsd(raw: string, key: string, fallback: number, max: number): number {
  const v = Number(raw);
  if (!raw.trim() || !Number.isFinite(v)) {
    console.warn(`[ai] ${key} is not a number; using the default of $${fallback}.`);
    return fallback;
  }
  return Math.min(max, Math.max(0, v));
}

/**
 * Parse the paused list. Anything unparsable pauses EVERYTHING: a setting
 * nobody can read must fail closed, never open.
 */
export function parsePausedFeatures(raw: string): AiFeature[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) throw new Error("not an array");
    const out: AiFeature[] = [];
    for (const f of v) {
      if (!AI_FEATURES.includes(f as AiFeature)) throw new Error(`unknown feature in the list`);
      out.push(f as AiFeature);
    }
    return out;
  } catch (e) {
    console.error(
      `[ai] ${AI_PAUSED_FEATURES_KEY} could not be read, so every AI feature is paused. Re-save the AI controls in /superadmin/ai.`,
      e instanceof Error ? e.message : e,
    );
    return [...AI_FEATURES];
  }
}

/**
 * Read uncached on purpose: a kill switch has to take effect on the very next
 * call, not when a cache expires.
 */
export async function getAiPlatformState(): Promise<AiPlatformState> {
  const [kill, ceiling, share, paused, byPlan] = await Promise.all([
    getSetting(AI_KILL_KEY, "off"),
    getSetting(AI_PLATFORM_CEILING_KEY, String(AI_PLATFORM_CEILING_DEFAULT_USD)),
    getSetting(AI_CHURCH_SHARE_KEY, String(AI_CHURCH_SHARE_DEFAULT_USD)),
    getSetting(AI_PAUSED_FEATURES_KEY, "[]"),
    readChurchShareByPlan(),
  ]);
  const platformCeilingUsd = clampUsd(
    ceiling,
    AI_PLATFORM_CEILING_KEY,
    AI_PLATFORM_CEILING_DEFAULT_USD,
    AI_PLATFORM_CEILING_MAX_USD,
  );
  const churchShareUsd = clampUsd(share, AI_CHURCH_SHARE_KEY, AI_CHURCH_SHARE_DEFAULT_USD, AI_CHURCH_SHARE_MAX_USD);
  return {
    configured: aiConfigured(),
    // Anything other than a plain "off" counts as on: fail closed.
    killed: kill.trim() !== "off",
    pausedFeatures: parsePausedFeatures(paused),
    platformCeilingNano: usdToNano(platformCeilingUsd),
    churchShareNano: usdToNano(churchShareUsd),
    platformCeilingUsd,
    churchShareUsd,
    churchShareByPlanUsd: byPlan,
  };
}

async function readChurchShareByPlan(): Promise<Record<PlanId, number>> {
  const raw = await getSetting(AI_CHURCH_SHARE_BY_PLAN_KEY, "");
  // Absent is the normal state until an admin saves: the defaults, silently.
  if (!raw.trim()) return { ...AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD };
  const parsed = parseChurchShareByPlan(raw);
  if (!parsed.ok) warnOnce(AI_CHURCH_SHARE_BY_PLAN_KEY, "using the default share for each plan.");
  return parsed.value;
}

/** The four plan shares as an admin saves them: clamped to 0..$5 each, rounded to cents. */
export async function setChurchShareByPlan(
  input: Partial<Record<PlanId, number>>,
): Promise<Record<PlanId, number>> {
  const clean = normaliseChurchShareByPlan(input);
  await setSetting(AI_CHURCH_SHARE_BY_PLAN_KEY, JSON.stringify(clean));
  return clean;
}

/* ------------------------------------------------------------------ *
 * The assistant's allowances and the church advisor's rollout
 * ------------------------------------------------------------------ */

/** JSON `{ starter, growth, pro, enterprise, perPersonDaily }`; plans may be null (no ceiling). */
export const ASSISTANT_ALLOWANCES_KEY = "assistant_allowances";
/** "off" | "pilot" | "all". Default "pilot". */
export const ASSISTANT_ADVISOR_ROLLOUT_KEY = "assistant_advisor_rollout";
/** JSON array of church slugs. Default `["flockinsight-church"]`. */
export const ASSISTANT_ADVISOR_PILOT_KEY = "assistant_advisor_pilot";

/**
 * The question allowances in force: the admin's override, or the code
 * defaults in lib/entitlements.ts when there is none or it cannot be read.
 * Uncached, like every AI control, so a change applies to the next question.
 */
export async function getAssistantAllowances(): Promise<AssistantAllowances> {
  const raw = await getSetting(ASSISTANT_ALLOWANCES_KEY, "");
  const parsed = parseAssistantAllowances(raw);
  if (!parsed.ok && raw.trim()) {
    warnOnce(ASSISTANT_ALLOWANCES_KEY, "using the allowances in lib/entitlements.ts.");
  }
  return parsed.value;
}

/** Saves an override. Refuses (returns false) anything parseAssistantAllowances would not read back. */
export async function setAssistantAllowances(input: AssistantAllowances): Promise<boolean> {
  const clean = validateAssistantAllowances(input);
  if (!clean) return false;
  await setSetting(ASSISTANT_ALLOWANCES_KEY, JSON.stringify(clean));
  return true;
}

export async function getAdvisorRollout(): Promise<AdvisorRollout> {
  const raw = await getSetting(ASSISTANT_ADVISOR_ROLLOUT_KEY, ADVISOR_ROLLOUT_DEFAULT);
  const parsed = parseAdvisorRollout(raw);
  if (!parsed.ok) {
    warnOnce(ASSISTANT_ADVISOR_ROLLOUT_KEY, "the church advisor is off until it is saved again.");
  }
  return parsed.value;
}

/** Saves the rollout. Only the three exact words are stored; anything else is stored as "off". */
export async function setAdvisorRollout(rollout: AdvisorRollout): Promise<void> {
  await setSetting(ASSISTANT_ADVISOR_ROLLOUT_KEY, parseAdvisorRollout(rollout).value);
}

export async function getAdvisorPilot(): Promise<string[]> {
  const raw = await getSetting(ASSISTANT_ADVISOR_PILOT_KEY, JSON.stringify(ADVISOR_PILOT_DEFAULT));
  const parsed = parseAdvisorPilot(raw);
  if (!parsed.ok) {
    warnOnce(ASSISTANT_ADVISOR_PILOT_KEY, "no church is in the advisor pilot until it is saved again.");
  }
  return parsed.value;
}

/** Saves the pilot list. Refuses (returns null) a list holding anything that is not a church slug. */
export async function setAdvisorPilot(slugs: readonly string[]): Promise<string[] | null> {
  const clean = normaliseAdvisorPilot(slugs);
  if (!clean) return null;
  await setSetting(ASSISTANT_ADVISOR_PILOT_KEY, JSON.stringify(clean));
  return clean;
}

export async function setKillSwitch(on: boolean): Promise<void> {
  await setSetting(AI_KILL_KEY, on ? "on" : "off");
}

export async function setCeilings(input: { platformUsd: number; churchUsd: number }): Promise<void> {
  const p = Math.min(AI_PLATFORM_CEILING_MAX_USD, Math.max(0, Math.round(input.platformUsd * 100) / 100));
  const c = Math.min(AI_CHURCH_SHARE_MAX_USD, Math.max(0, Math.round(input.churchUsd * 100) / 100));
  await Promise.all([
    setSetting(AI_PLATFORM_CEILING_KEY, String(p)),
    setSetting(AI_CHURCH_SHARE_KEY, String(c)),
  ]);
}

export async function setPausedFeatures(list: AiFeature[]): Promise<void> {
  const clean = AI_FEATURES.filter((f) => list.includes(f));
  await setSetting(AI_PAUSED_FEATURES_KEY, JSON.stringify(clean));
}

/* ------------------------------------------------------------------ *
 * A church's consent
 * ------------------------------------------------------------------ */

export type ChurchAiSetting = {
  enabled: boolean;
  changedByName: string | null;
  enabledAt: Date | null;
  /** "About our church", as the owner wrote it. Scrubbed again before it is ever sent. */
  notes: string | null;
};

/** The most an owner may write in "About our church". The same number the page's counter shows. */
export const CHURCH_AI_NOTES_MAX = CHURCH_NOTES_MAX;

/** No row means disabled: every church is opt-in. */
export async function getChurchAiSetting(churchId: string): Promise<ChurchAiSetting> {
  const [row] = await db
    .select({
      enabled: aiChurchSetting.enabled,
      enabledAt: aiChurchSetting.enabledAt,
      notes: aiChurchSetting.notes,
      changedByName: user.name,
    })
    .from(aiChurchSetting)
    .leftJoin(user, eq(user.id, aiChurchSetting.changedByUserId))
    .where(eq(aiChurchSetting.churchId, churchId))
    .limit(1);
  return {
    enabled: row?.enabled ?? false,
    changedByName: row?.changedByName ?? null,
    enabledAt: row?.enabledAt ?? null,
    notes: row?.notes ?? null,
  };
}

export async function setChurchAiEnabled(churchId: string, enabled: boolean, userId: string): Promise<void> {
  const now = new Date();
  const stamps = enabled ? { enabledAt: now } : { disabledAt: now };
  await db
    .insert(aiChurchSetting)
    .values({ churchId, enabled, changedByUserId: userId, ...stamps })
    .onConflictDoUpdate({
      target: aiChurchSetting.churchId,
      set: { enabled, changedByUserId: userId, ...stamps },
    });
}

/**
 * Saves "About our church". The caller decides who may (the church's own
 * owner, never act-as, never the demo) and scrubs it; this only clips and
 * stores. Writing notes never turns AI on: a church with no row gets one with
 * enabled false.
 *
 * changed_by_user_id is left alone: the settings page reads it as "Turned on
 * by <name>", the record of who consented to sending the church's data, and
 * only setChurchAiEnabled may write it. Who edited the notes is in the audit
 * trail (settings.ai.notes).
 */
export async function setChurchAiNotes(churchId: string, notes: string): Promise<void> {
  const clean = notes.trim().slice(0, CHURCH_AI_NOTES_MAX) || null;
  await db
    .insert(aiChurchSetting)
    .values({ churchId, enabled: false, notes: clean })
    .onConflictDoUpdate({
      target: aiChurchSetting.churchId,
      set: { notes: clean },
    });
}

export type ChurchAiAvailability = {
  configured: boolean;
  killed: boolean;
  analyticsPaused: boolean;
  optedIn: boolean;
  isDemo: boolean;
  onPlan: boolean;
};

/**
 * Which state the UI should show. Read-only: it never claims a day or
 * touches a budget, so rendering a page costs nothing.
 */
export async function churchAiAvailability(churchId: string): Promise<ChurchAiAvailability> {
  const [state, setting, [row]] = await Promise.all([
    getAiPlatformState(),
    getChurchAiSetting(churchId),
    db
      .select({ plan: church.plan, slug: church.slug, isDemo: church.isDemo })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1),
  ]);
  return {
    configured: state.configured,
    killed: state.killed,
    analyticsPaused: state.pausedFeatures.includes("analytics"),
    optedIn: setting.enabled,
    isDemo: row?.isDemo ?? false,
    onPlan: row ? churchRowHasFeature(row, "aiSummaries") : false,
  };
}
