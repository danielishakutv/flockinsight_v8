import "server-only";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, member } from "@/db/schema";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";

export type MemberLimitStatus = {
  limit: number | null; // null = unlimited
  used: number;
  atLimit: boolean;
  plan: string;
};

/** Current member count vs the church's plan limit. */
export async function memberLimitStatus(
  churchId: string,
): Promise<MemberLimitStatus> {
  const [c] = await db
    .select({ plan: church.plan })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  const plan = (c?.plan as PlanId) ?? "starter";
  const limit = PLAN_BY_ID[plan]?.memberLimit ?? null;
  const [{ used }] = await db
    .select({ used: count() })
    .from(member)
    .where(eq(member.churchId, churchId));
  const usedN = Number(used);
  return { plan, limit, used: usedN, atLimit: limit !== null && usedN >= limit };
}
