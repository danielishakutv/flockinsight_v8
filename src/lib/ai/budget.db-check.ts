/**
 * Database-backed checks for the AI budget claim path. Run with `pnpm test:db`.
 *
 * A reservation is "find the headroom, then take it", which READ COMMITTED
 * alone does not protect: two requests can both see room for one and both
 * spend it. These race real transactions over a SINGLE contested
 * ai_budget_month row, deliberately interleaved with the first one held open,
 * rather than a Promise.all that may happen to serialise and pass whether the
 * bug is there or not.
 *
 * Budget months in 2099 are used so nothing here touches a real month's row.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiBudgetMonth, aiCall } from "@/db/schema";

const { reserve, settle, sweepAbandoned, BudgetRefused, PLATFORM_SUBJECT } = await import("@/lib/ai/budget");

const stamp = Date.now();
const callIds: string[] = [];

afterAll(async () => {
  for (const id of callIds) await db.delete(aiCall).where(eq(aiCall.id, id));
  await db.delete(aiBudgetMonth).where(like(aiBudgetMonth.month, "2099-%"));
});

async function platformRow(month: string) {
  const [row] = await db
    .select()
    .from(aiBudgetMonth)
    .where(and(eq(aiBudgetMonth.month, month), eq(aiBudgetMonth.subject, PLATFORM_SUBJECT)));
  return row;
}

const baseReserve = {
  churchId: null,
  feature: "analytics" as const,
  promptId: "analytics-platform@1",
  payloadSchema: "platform-facts@1",
  model: "claude-haiku-5-5",
  requestJson: JSON.stringify({ body: { zzcheck: stamp } }),
  sha: "0".repeat(64),
  actorUserId: null,
  churchShareNano: 0,
};

describe("reserve", () => {
  it("lets exactly one of two interleaved reservations through when only one fits", async () => {
    const month = "2099-01";
    const now = new Date("2099-01-15T12:00:00Z");
    await db.insert(aiBudgetMonth).values({ month, subject: PLATFORM_SUBJECT }).onConflictDoNothing();

    // T1 takes the row and reserves 600 of a 1000 ceiling, then holds its
    // transaction open, as a reservation in flight would.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let took!: () => void;
    const taken = new Promise<void>((r) => (took = r));
    const t1 = db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: aiBudgetMonth.id })
        .from(aiBudgetMonth)
        .where(and(eq(aiBudgetMonth.month, month), eq(aiBudgetMonth.subject, PLATFORM_SUBJECT)))
        .for("update");
      const won = await tx
        .update(aiBudgetMonth)
        .set({ reservedNano: sql`${aiBudgetMonth.reservedNano} + 600` })
        .where(
          and(
            eq(aiBudgetMonth.id, row.id),
            sql`${aiBudgetMonth.spentNano} + ${aiBudgetMonth.reservedNano} + 600 <= 1000`,
          ),
        )
        .returning({ id: aiBudgetMonth.id });
      took();
      await held;
      return won.length;
    });
    await taken;

    // T2 is the real reserve(), started while T1 is uncommitted. Its FOR
    // UPDATE waits for T1, then its predicate sees 600 already held.
    const t2 = reserve({ ...baseReserve, reservedNano: 600, platformCeilingNano: 1000, now }).then(
      (r) => {
        callIds.push(r.callId);
        return "reserved" as const;
      },
      (e: unknown) => (e instanceof BudgetRefused ? e.reason : Promise.reject(e)),
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    const [won1, outcome2] = await Promise.all([t1, t2]);

    expect(won1).toBe(1);
    expect(outcome2).toBe("platform_budget");
    const row = await platformRow(month);
    expect(row.reservedNano).toBe(600);
  });
});

describe("sweep and settle on the same call", () => {
  async function staleCall(now: Date, reservedNano: number): Promise<string> {
    const { callId } = await reserve({ ...baseReserve, reservedNano, platformCeilingNano: 10 ** 12, now });
    callIds.push(callId);
    await db
      .update(aiCall)
      .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(aiCall.id, callId));
    return callId;
  }

  async function holdPlatformRow(month: string) {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let took!: () => void;
    const taken = new Promise<void>((r) => (took = r));
    const t = db.transaction(async (tx) => {
      await tx
        .select({ id: aiBudgetMonth.id })
        .from(aiBudgetMonth)
        .where(and(eq(aiBudgetMonth.month, month), eq(aiBudgetMonth.subject, PLATFORM_SUBJECT)))
        .for("update");
      took();
      await held;
    });
    await taken;
    return { release, done: t };
  }

  it("charges exactly once when the sweep gets the lock first", async () => {
    const month = "2099-02";
    const now = new Date("2099-02-15T12:00:00Z");
    const id = await staleCall(now, 5000);
    const before = await platformRow(month);

    const hold = await holdPlatformRow(month);
    const sweep = sweepAbandoned();
    await new Promise((r) => setTimeout(r, 300));
    const settling = settle(id, { status: "ok", costNano: 1234 });
    await new Promise((r) => setTimeout(r, 300));
    hold.release();
    await Promise.all([hold.done, sweep, settling]);

    const after = await platformRow(month);
    expect(after.reservedNano - before.reservedNano).toBe(-5000);
    expect(after.spentNano - before.spentNano).toBe(1234);
    const [call] = await db.select().from(aiCall).where(eq(aiCall.id, id));
    expect(call.status).toBe("ok");
    expect(call.costNano).toBe(1234);
  });

  it("charges exactly once when the settle gets the lock first", async () => {
    const month = "2099-03";
    const now = new Date("2099-03-15T12:00:00Z");
    const id = await staleCall(now, 5000);
    const before = await platformRow(month);

    const hold = await holdPlatformRow(month);
    const settling = settle(id, { status: "ok", costNano: 777 });
    await new Promise((r) => setTimeout(r, 300));
    const sweep = sweepAbandoned();
    await new Promise((r) => setTimeout(r, 300));
    hold.release();
    await Promise.all([hold.done, sweep, settling]);

    const after = await platformRow(month);
    expect(after.reservedNano - before.reservedNano).toBe(-5000);
    expect(after.spentNano - before.spentNano).toBe(777);
  });
});
