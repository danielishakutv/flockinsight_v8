import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiChurchSetting, church, user, type AiFeature } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/platform-settings";
import { churchRowHasFeature } from "@/lib/entitlements";
import { aiConfigured } from "./config";
import { usdToNano } from "./budget-rules";

/* ------------------------------------------------------------------ *
 * Platform controls, in platform_setting
 * ------------------------------------------------------------------ */

/** "on" = every AI feature stopped. Default "off". */
export const AI_KILL_KEY = "ai_kill_switch";
/** Monthly platform ceiling in USD. Default "20", clamped to 0..AI_PLATFORM_CEILING_MAX_USD. */
export const AI_PLATFORM_CEILING_KEY = "ai_platform_monthly_usd";
/** Each church's monthly share in USD. Default "0.50", clamped to 0..AI_CHURCH_SHARE_MAX_USD. */
export const AI_CHURCH_SHARE_KEY = "ai_church_monthly_usd";
/** JSON array of AiFeature. Default "[]". */
export const AI_PAUSED_FEATURES_KEY = "ai_paused_features";

/**
 * The hard stop. It cannot be raised from the UI: raising it is a code change,
 * which is the owner's decision, not a setting an operator can drift past.
 */
export const AI_PLATFORM_CEILING_MAX_USD = 20;
export const AI_CHURCH_SHARE_MAX_USD = 5;
export const AI_PLATFORM_CEILING_DEFAULT_USD = 20;
export const AI_CHURCH_SHARE_DEFAULT_USD = 0.5;

export const AI_FEATURES: readonly AiFeature[] = ["analytics", "chat", "blog"];

export type AiPlatformState = {
  configured: boolean;
  killed: boolean;
  pausedFeatures: AiFeature[];
  platformCeilingNano: number;
  churchShareNano: number;
  platformCeilingUsd: number;
  churchShareUsd: number;
};

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
  const [kill, ceiling, share, paused] = await Promise.all([
    getSetting(AI_KILL_KEY, "off"),
    getSetting(AI_PLATFORM_CEILING_KEY, String(AI_PLATFORM_CEILING_DEFAULT_USD)),
    getSetting(AI_CHURCH_SHARE_KEY, String(AI_CHURCH_SHARE_DEFAULT_USD)),
    getSetting(AI_PAUSED_FEATURES_KEY, "[]"),
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
  };
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
};

/** No row means disabled: every church is opt-in. */
export async function getChurchAiSetting(churchId: string): Promise<ChurchAiSetting> {
  const [row] = await db
    .select({
      enabled: aiChurchSetting.enabled,
      enabledAt: aiChurchSetting.enabledAt,
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
