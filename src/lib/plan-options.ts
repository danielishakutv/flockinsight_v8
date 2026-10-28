import { PLANS, customPlanKey, type PlanId } from "@/lib/plans";

/**
 * The plans a superadmin may put a church on: the four tiers, then every
 * custom plan that is not archived. A church already on an archived plan
 * still sees it, so opening its billing card never silently offers to move
 * it off the plan it is on.
 *
 * Pure, so the church page and anything else with a picker list the same
 * plans in the same order.
 */
export type PlanOption = { key: string; name: string; custom: boolean; archived: boolean };

export function pickablePlans(
  customs: ReadonlyArray<{
    id: string;
    name: string;
    basePlan: PlanId;
    archivedAt: Date | null;
  }>,
  /** Custom plan ids to list even when archived: the plans churches are on now. */
  keep: Iterable<string | null> = [],
): PlanOption[] {
  const kept = new Set(keep);
  return [
    ...PLANS.map((p) => ({ key: p.id, name: p.name, custom: false, archived: false })),
    ...customs
      .filter((c) => !c.archivedAt || kept.has(c.id))
      .map((c) => ({
        key: customPlanKey(c.id),
        name: c.archivedAt ? `${c.name} (archived)` : c.name,
        custom: true,
        archived: !!c.archivedAt,
      })),
  ];
}
