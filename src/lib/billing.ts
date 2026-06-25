import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";

/** Monthly price after an admin-granted discount. null = custom (Enterprise). */
export function effectivePrice(
  plan: string,
  discountPct: number,
): number | null {
  const base = PLAN_BY_ID[plan as PlanId]?.priceMonthly;
  if (base === undefined || base === null) return null;
  const pct = Math.min(100, Math.max(0, discountPct || 0));
  return Math.max(0, Math.round(base * (1 - pct / 100)));
}

/**
 * Set a church's plan and extend its renewal date by `months`. Extends from
 * the later of "now" or the current renewal date (so renewing early doesn't
 * lose remaining time).
 */
export async function activatePlan(
  churchId: string,
  plan: PlanId,
  months: number,
): Promise<Date> {
  const [c] = await db
    .select({ renewsAt: church.planRenewsAt })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  const now = new Date();
  const base =
    c?.renewsAt && new Date(c.renewsAt) > now ? new Date(c.renewsAt) : now;
  const renews = new Date(base);
  renews.setMonth(renews.getMonth() + months);
  await db
    .update(church)
    .set({ plan, planRenewsAt: renews })
    .where(eq(church.id, churchId));
  return renews;
}
