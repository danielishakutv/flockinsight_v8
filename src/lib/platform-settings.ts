import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSetting } from "@/db/schema";

export const SMS_PRICE_KEY = "sms_price";
export const DEFAULT_SMS_PRICE = 4; // ₦ per SMS page, until an admin sets it

export async function getSetting(
  key: string,
  fallback: string,
): Promise<string> {
  const [row] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, key))
    .limit(1);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(platformSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: platformSetting.key, set: { value } });
}

export async function getSmsPrice(): Promise<number> {
  const v = Number(await getSetting(SMS_PRICE_KEY, String(DEFAULT_SMS_PRICE)));
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SMS_PRICE;
}

/* ---------- Termii master wallet ("the float") ---------- */

export const TERMII_UNIT_COST_KEY = "termii_unit_cost";
export const TERMII_UNIT_COST_MODE_KEY = "termii_unit_cost_mode";
export const RUNWAY_WARN_KEY = "float_runway_warn_days";
export const RUNWAY_CRITICAL_KEY = "float_runway_critical_days";

export const DEFAULT_RUNWAY_WARN_DAYS = 14;
export const DEFAULT_RUNWAY_CRITICAL_DAYS = 5;

export type UnitCostMode = "manual" | "auto";

/**
 * What Termii charges per SMS page, as configured. Returns null when unset —
 * callers must treat that as "unknown" rather than free.
 */
export async function getTermiiUnitCost(): Promise<number | null> {
  const raw = await getSetting(TERMII_UNIT_COST_KEY, "");
  if (!raw.trim()) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Manual by default: auto-derivation needs about a week of balance snapshots
 * before it can see a reliable drawdown.
 */
export async function getUnitCostMode(): Promise<UnitCostMode> {
  const raw = await getSetting(TERMII_UNIT_COST_MODE_KEY, "manual");
  return raw === "auto" ? "auto" : "manual";
}

export async function getRunwayThresholds(): Promise<{
  warn: number;
  critical: number;
}> {
  const [warnRaw, critRaw] = await Promise.all([
    getSetting(RUNWAY_WARN_KEY, String(DEFAULT_RUNWAY_WARN_DAYS)),
    getSetting(RUNWAY_CRITICAL_KEY, String(DEFAULT_RUNWAY_CRITICAL_DAYS)),
  ]);
  const warn = Number(warnRaw);
  const critical = Number(critRaw);
  return {
    warn: Number.isFinite(warn) && warn > 0 ? warn : DEFAULT_RUNWAY_WARN_DAYS,
    critical:
      Number.isFinite(critical) && critical > 0
        ? critical
        : DEFAULT_RUNWAY_CRITICAL_DAYS,
  };
}
