/**
 * Database-backed checks for the plan gates. Run with `pnpm test:db`.
 *
 * `entitlements.test.ts` covers the map with no database. What is asserted here
 * is the half that reads real rows, because that is where a gate goes wrong
 * quietly: a plan column that is null, a church that no longer exists, a team
 * count that includes somebody it should not. Each of those would resolve to
 * "allowed" if written carelessly, and a gate that fails open is not a gate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff } from "@/db/schema";
import { churchPlanOf, teamLimitStatus } from "@/lib/entitlements-server";
import { planIncludes, teamLimitFor } from "@/lib/entitlements";
import type { PlanId } from "@/lib/plans";

let churchId = "";
let realPlan: PlanId = "starter";

async function setPlan(plan: PlanId) {
  await db.update(church).set({ plan }).where(eq(church.id, churchId));
}

beforeAll(async () => {
  const [c] = await db.select({ id: church.id, plan: church.plan }).from(church).limit(1);
  churchId = c.id;
  realPlan = c.plan;
});

afterAll(async () => {
  // This is a real church row that every other file here reads. Put it back.
  await setPlan(realPlan);
});

describe("reading a church's plan", () => {
  it("reads what is actually stored", async () => {
    await setPlan("pro");
    expect(await churchPlanOf(churchId)).toBe("pro");
    await setPlan("growth");
    expect(await churchPlanOf(churchId)).toBe("growth");
  });

  it("gives the smallest allowance for a church that does not exist", async () => {
    /*
     * The path that matters: a meeting link for a church since deleted, a stale
     * id in somebody's bookmark. Falling back to "starter" means the gate closes;
     * falling back to undefined and letting `planIncludes` see it would too, but
     * only by accident — so it is asserted rather than assumed.
     */
    const plan = await churchPlanOf("no-such-church");
    expect(plan).toBe("starter");
    expect(planIncludes(plan, "finance")).toBe(false);
    expect(planIncludes(plan, "meetings")).toBe(false);
  });

  it("turns a stored plan into the right answers for each feature", async () => {
    await setPlan("growth");
    const plan = await churchPlanOf(churchId);
    expect(planIncludes(plan, "meetings")).toBe(true);
    expect(planIncludes(plan, "training")).toBe(true);
    expect(planIncludes(plan, "finance")).toBe(false);
    expect(planIncludes(plan, "meetings.repeat")).toBe(false);
  });
});

describe("team size", () => {
  it("counts the staff that are really there", async () => {
    await setPlan("pro");
    const [{ n }] = await db
      .select({ n: db.$count(staff, eq(staff.organizationId, churchId)) })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1);
    const status = await teamLimitStatus(churchId);
    expect(status.used).toBe(Number(n));
  });

  it("is never at the limit on a plan with no ceiling", async () => {
    // `null` means unlimited, and the obvious implementation of this (`?? 1`)
    // turns unlimited into one. It did, once.
    for (const plan of ["pro", "enterprise"] as PlanId[]) {
      await setPlan(plan);
      const status = await teamLimitStatus(churchId);
      expect(status.limit).toBeNull();
      expect(status.atLimit).toBe(false);
    }
  });

  it("reports a church that is over its plan without removing anybody", async () => {
    /*
     * The real situation this was written for: a church on Starter with twelve
     * administrators, because the limit was advertised and never enforced. It is
     * over, it is reported as over, and every one of those twelve is still there
     * — the limit applies to the next invitation, not to the people already in.
     */
    await setPlan("starter");
    const before = await teamLimitStatus(churchId);
    expect(before.limit).toBe(teamLimitFor("starter"));

    if (before.used > 1) {
      expect(before.atLimit).toBe(true);
    }

    const after = await teamLimitStatus(churchId);
    expect(after.used).toBe(before.used); // nobody was touched by asking
  });

  it("falls back to the smallest team for a church that does not exist", async () => {
    const status = await teamLimitStatus("no-such-church");
    expect(status.plan).toBe("starter");
    expect(status.limit).toBe(1);
  });
});
