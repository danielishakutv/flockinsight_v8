import "server-only";
import { cache } from "react";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff } from "@/db/schema";
import { getSession, getActAsChurchId } from "@/lib/session";
import {
  planIncludes,
  teamLimitFor,
  upgradeMessage,
  type FeatureKey,
} from "@/lib/entitlements";

/**
 * The enforcing half of the price list.
 *
 * `lib/entitlements.ts` says what each plan includes; this says what to do about
 * it. Deliberately the same shape as `can` / `requireCan` in lib/permissions.ts,
 * because they answer the two halves of the same question — may this PERSON do
 * it, and does this CHURCH pay for it — and code that guards one should read
 * like code that guards the other.
 *
 * The asymmetry that matters: a permission failure hides a page, a plan failure
 * does not. A church keeps READING what it has already entered; only the writes
 * stop. See the note at the top of lib/entitlements.ts for why.
 */

/**
 * The active church's plan, once per request.
 *
 * A superadmin acting as a church sees that church's real plan rather than
 * everything: the point of impersonation is to see what the church sees, and a
 * support person who cannot reproduce a blocked write cannot diagnose it.
 */
export const activePlan = cache(async (): Promise<string> => {
  const data = await getSession();
  const churchId = (await getActAsChurchId()) ?? data?.session?.activeOrganizationId;
  if (!churchId) return "starter";

  const [row] = await db
    .select({ plan: church.plan })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  // No row, or no plan: the smallest allowance, never the largest.
  return row?.plan ?? "starter";
});

/**
 * One church's plan, by id.
 *
 * For the paths where there is no active church to read: a meeting room is
 * reached by a link, and the person holding it may not be signed in at all. The
 * plan that applies is the MEETING's church's, not the visitor's.
 */
export async function churchPlanOf(churchId: string): Promise<string> {
  const [row] = await db
    .select({ plan: church.plan })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return row?.plan ?? "starter";
}

/** Whether the active church's plan includes a feature. */
export async function hasFeature(feature: FeatureKey): Promise<boolean> {
  return planIncludes(await activePlan(), feature);
}

/** Several at once, for a page that renders more than one gated section. */
export async function hasFeatures<K extends FeatureKey>(
  ...features: K[]
): Promise<Record<K, boolean>> {
  const plan = await activePlan();
  return Object.fromEntries(features.map((f) => [f, planIncludes(plan, f)])) as Record<
    K,
    boolean
  >;
}

export type FeatureRefusal = { ok: false; error: string; upgrade: FeatureKey };

/**
 * The guard every write goes through.
 *
 * Returns a refusal to RETURN, rather than throwing or redirecting, because
 * that is the shape every server action in this app already speaks:
 *
 *     const gate = await refuseWithoutFeature("finance");
 *     if (gate) return gate;
 *
 * A thrown error would surface as "something went wrong", which tells a church
 * administrator nothing and sends them to support. This says which feature,
 * which plan, and what the feature does.
 */
export async function refuseWithoutFeature(
  feature: FeatureKey,
): Promise<FeatureRefusal | null> {
  if (await hasFeature(feature)) return null;
  return { ok: false, error: upgradeMessage(feature), upgrade: feature };
}

/**
 * How many staff the active church has, and how many it may have.
 *
 * Advertised since the beginning ("1 admin account", "Up to 10 team members")
 * and enforced nowhere, which is how one church came to be on Starter with
 * twelve administrators. Nobody is removed — the limit applies to the NEXT
 * invitation, exactly as the member limit applies to the next member.
 */
export async function teamLimitStatus(churchId: string): Promise<{
  plan: string;
  limit: number | null;
  used: number;
  atLimit: boolean;
}> {
  const [c] = await db
    .select({ plan: church.plan })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  const plan = c?.plan ?? "starter";
  const limit = teamLimitFor(plan);

  const [{ used }] = await db
    .select({ used: count() })
    .from(staff)
    .where(eq(staff.organizationId, churchId));

  const usedN = Number(used);
  return { plan, limit, used: usedN, atLimit: limit !== null && usedN >= limit };
}
