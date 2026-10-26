/**
 * Database-backed checks for the assistant's allowance counter. Run with
 * `pnpm test:db`.
 *
 * A claim is "is there a question left? then take it", which READ COMMITTED
 * alone does not protect: two questions at the limit can both see one left
 * and both take it (AGENTS.md). These race a real claim against a second
 * transaction held open over a SINGLE contested assistant_usage row, rather
 * than a Promise.all that may happen to serialise and pass whether the bug is
 * there or not.
 *
 * Every row here is in January 2099 and has a zzcheck- subject, so nothing
 * touches a real church's month or a real person's day; afterAll removes
 * exactly those rows.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { assistantUsage } from "@/db/schema";

const { claimAssistantQuestion, readAssistantUsage, refundAssistantQuestion } = await import(
  "@/lib/assistant/usage"
);

const stamp = Date.now();
const NOW = new Date("2099-01-15T12:00:00Z");
const MONTH = "2099-01";
const DAY = "2099-01-15";
const subjects: string[] = [];

function ids(name: string) {
  const churchId = `zzcheck-church-${name}-${stamp}`;
  const userId = `zzcheck-user-${name}-${stamp}`;
  subjects.push(`church:${churchId}`, `user:${userId}`);
  return { churchId, userId };
}

async function used(period: string, subject: string): Promise<number | null> {
  const [row] = await db
    .select({ used: assistantUsage.used })
    .from(assistantUsage)
    .where(and(eq(assistantUsage.period, period), eq(assistantUsage.subject, subject)));
  return row ? row.used : null;
}

afterAll(async () => {
  if (subjects.length > 0) await db.delete(assistantUsage).where(inArray(assistantUsage.subject, subjects));
});

describe("claimAssistantQuestion", () => {
  it("lets exactly one of two interleaved claims through when one question is left", async () => {
    const { churchId, userId } = ids("race");
    const LIMIT = 3;
    // Two questions asked: one left.
    for (let i = 0; i < LIMIT - 1; i++) {
      const r = await claimAssistantQuestion({ churchId, userId, monthlyLimit: LIMIT, dailyLimit: 25, now: NOW });
      expect(r.ok).toBe(true);
    }
    expect(await used(MONTH, `church:${churchId}`)).toBe(LIMIT - 1);

    // T1 takes the church's month row and the last question, exactly as a
    // claim does, then holds its transaction open.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let took!: () => void;
    const taken = new Promise<void>((r) => (took = r));
    const t1 = db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: assistantUsage.id })
        .from(assistantUsage)
        .where(and(eq(assistantUsage.period, MONTH), eq(assistantUsage.subject, `church:${churchId}`)))
        .for("update");
      const won = await tx
        .update(assistantUsage)
        .set({ used: sql`${assistantUsage.used} + 1` })
        .where(and(eq(assistantUsage.id, row.id), lt(assistantUsage.used, LIMIT)))
        .returning({ used: assistantUsage.used });
      took();
      await held;
      return won.length;
    });
    await taken;

    // T2, the real claim, must wait for T1's lock and then find nothing left.
    const order: string[] = [];
    const t2 = claimAssistantQuestion({ churchId, userId, monthlyLimit: LIMIT, dailyLimit: 25, now: NOW }).then(
      (r) => {
        order.push("t2 done");
        return r;
      },
    );
    await new Promise((r) => setTimeout(r, 300));
    order.push("t1 released");
    release();

    const [t1Won, t2Result] = await Promise.all([t1, t2]);
    expect(t1Won).toBe(1);
    expect(t2Result).toEqual({ ok: false, code: "monthlyLimit", limit: LIMIT });
    expect(order).toEqual(["t1 released", "t2 done"]);
    expect(await used(MONTH, `church:${churchId}`)).toBe(LIMIT);
    // The refused claim spent none of the person's day: it rolled back whole.
    expect(await used(DAY, `user:${userId}`)).toBe(LIMIT - 1);
  });

  it("refuses at the person's daily limit without spending the church's month", async () => {
    const { churchId, userId } = ids("daily");
    for (let i = 0; i < 2; i++) {
      expect((await claimAssistantQuestion({ churchId, userId, monthlyLimit: 100, dailyLimit: 2, now: NOW })).ok).toBe(
        true,
      );
    }
    const r = await claimAssistantQuestion({ churchId, userId, monthlyLimit: 100, dailyLimit: 2, now: NOW });
    expect(r).toEqual({ ok: false, code: "dailyLimit", limit: 2 });
    expect(await used(MONTH, `church:${churchId}`)).toBe(2);
    expect(await used(DAY, `user:${userId}`)).toBe(2);
  });

  it("reads a null monthly limit as no ceiling", async () => {
    const { churchId, userId } = ids("unlimited");
    for (let i = 0; i < 5; i++) {
      const r = await claimAssistantQuestion({ churchId, userId, monthlyLimit: null, dailyLimit: 25, now: NOW });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.claim.monthUsed).toBe(i + 1);
    }
  });

  it("claims only the person's day in the platform scope, never a church's month", async () => {
    const { churchId, userId } = ids("platform");
    const r = await claimAssistantQuestion({ churchId: null, userId, monthlyLimit: 1, dailyLimit: 60, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claim.churchRowId).toBeNull();
    expect(r.claim.monthUsed).toBeNull();
    expect(r.claim.dayUsed).toBe(1);
    // No church row was created for anybody by this claim.
    expect(await used(MONTH, `church:${churchId}`)).toBeNull();
    const rows = await db
      .select({ subject: assistantUsage.subject, period: assistantUsage.period })
      .from(assistantUsage)
      .where(inArray(assistantUsage.subject, [`church:${churchId}`, `user:${userId}`]));
    expect(rows).toEqual([{ subject: `user:${userId}`, period: DAY }]);
  });
});

describe("refundAssistantQuestion", () => {
  it("hands back exactly the rows a claim took, and never goes below zero", async () => {
    const { churchId, userId } = ids("refund");
    const r = await claimAssistantQuestion({ churchId, userId, monthlyLimit: 10, dailyLimit: 10, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await used(MONTH, `church:${churchId}`)).toBe(1);

    await refundAssistantQuestion(r.claim);
    expect(await used(MONTH, `church:${churchId}`)).toBe(0);
    expect(await used(DAY, `user:${userId}`)).toBe(0);

    // A second refund of the same claim is floored, not refused.
    await refundAssistantQuestion(r.claim);
    expect(await used(MONTH, `church:${churchId}`)).toBe(0);
    expect(await used(DAY, `user:${userId}`)).toBe(0);
  });

  it("gives the question back to a church at its limit", async () => {
    const { churchId, userId } = ids("refund-limit");
    const first = await claimAssistantQuestion({ churchId, userId, monthlyLimit: 1, dailyLimit: 10, now: NOW });
    expect(first.ok).toBe(true);
    expect((await claimAssistantQuestion({ churchId, userId, monthlyLimit: 1, dailyLimit: 10, now: NOW })).ok).toBe(
      false,
    );
    if (first.ok) await refundAssistantQuestion(first.claim);
    expect((await claimAssistantQuestion({ churchId, userId, monthlyLimit: 1, dailyLimit: 10, now: NOW })).ok).toBe(
      true,
    );
  });
});

describe("readAssistantUsage", () => {
  it("reads the month and the day, and missing rows as 0", async () => {
    const { churchId, userId } = ids("read");
    expect(await readAssistantUsage({ churchId, userId, now: NOW })).toEqual({ monthUsed: 0, dayUsed: 0 });
    await claimAssistantQuestion({ churchId, userId, monthlyLimit: 10, dailyLimit: 10, now: NOW });
    await claimAssistantQuestion({ churchId, userId, monthlyLimit: 10, dailyLimit: 10, now: NOW });
    expect(await readAssistantUsage({ churchId, userId, now: NOW })).toEqual({ monthUsed: 2, dayUsed: 2 });
    expect(await readAssistantUsage({ churchId: null, userId, now: NOW })).toEqual({ monthUsed: null, dayUsed: 2 });
    // Another day is another row.
    expect(
      await readAssistantUsage({ churchId, userId, now: new Date("2099-01-16T00:00:00Z") }),
    ).toEqual({ monthUsed: 2, dayUsed: 0 });
  });
});
