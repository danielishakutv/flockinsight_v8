import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { type PlanId } from "@/lib/plans";
import { applyDiscount, getPlanPrice } from "@/lib/pricing";

/**
 * Monthly price after an admin-granted discount, using the admin-managed base
 * price. null = custom (Enterprise). Async because the base price is resolved
 * from platform settings.
 */
export async function effectivePrice(
  plan: string,
  discountPct: number,
): Promise<number | null> {
  return applyDiscount(await getPlanPrice(plan), discountPct);
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
