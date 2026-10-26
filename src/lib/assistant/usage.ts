import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { assistantUsage } from "@/db/schema";
import { churchUsageSubject, usagePeriods, userUsageSubject } from "./advisor-shared";

/*
 * The assistant's allowances, claimed BEFORE the model is asked.
 *
 * A claim is AGENTS.md's three parts, because counting assistant_message rows
 * is check-then-insert and READ COMMITTED lets two questions at the limit
 * both pass:
 *
 *   1. the rows exist first (INSERT ... ON CONFLICT DO NOTHING), so there is
 *      exactly one row to contend for, guaranteed by unique(period, subject);
 *   2. SELECT ... FOR UPDATE on them, the church's month first and then the
 *      person's day, in that order everywhere, so two claims cannot deadlock;
 *   3. the limit repeated in the UPDATE's WHERE (used < limit), with the
 *      returning() count checked. A miss throws, which rolls back the whole
 *      claim: a person at their daily limit never spends the church's month.
 *
 * A question the model was never asked is handed back (refund), so an outage
 * or a switched-off feature never eats anybody's allowance.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Which rows a claim took, so exactly those can be handed back. */
export type UsageClaim = {
  churchRowId: string | null;
  userRowId: string;
  /** The counts after this claim. */
  monthUsed: number | null;
  dayUsed: number;
};

export type ClaimResult =
  | { ok: true; claim: UsageClaim }
  | { ok: false; code: "monthlyLimit" | "dailyLimit"; limit: number };

class LimitReached extends Error {
  constructor(
    readonly code: "monthlyLimit" | "dailyLimit",
    readonly limit: number,
  ) {
    super(code);
  }
}

async function lockRow(tx: Tx, period: string, subject: string): Promise<{ id: string }> {
  const [row] = await tx
    .select({ id: assistantUsage.id })
    .from(assistantUsage)
    .where(and(eq(assistantUsage.period, period), eq(assistantUsage.subject, subject)))
    .for("update");
  if (!row) throw new Error(`The assistant_usage row for ${subject} ${period} is missing after it was created.`);
  return row;
}

/** One more question, if and only if the limit still allows it. Null limit means no ceiling. */
async function take(tx: Tx, rowId: string, limit: number | null): Promise<number | null> {
  const won = await tx
    .update(assistantUsage)
    .set({ used: sql`${assistantUsage.used} + 1` })
    .where(and(eq(assistantUsage.id, rowId), limit === null ? undefined : lt(assistantUsage.used, limit)))
    .returning({ used: assistantUsage.used });
  return won.length === 1 ? won[0].used : null;
}

/**
 * Claim one question. churchId null is the platform scope: a superadmin's
 * questions are charged to the platform, so only their own day is counted
 * and no church's month is touched.
 */
export async function claimAssistantQuestion(input: {
  churchId: string | null;
  userId: string;
  /** The church's monthly allowance; null = no ceiling. Ignored when churchId is null. */
  monthlyLimit: number | null;
  dailyLimit: number;
  now?: Date;
}): Promise<ClaimResult> {
  const p = usagePeriods(input.now ?? new Date());
  const churchSubject = input.churchId ? churchUsageSubject(input.churchId) : null;
  const userSubject = userUsageSubject(input.userId);
  try {
    const claim = await db.transaction(async (tx) => {
      await tx
        .insert(assistantUsage)
        .values([
          ...(churchSubject ? [{ period: p.month, subject: churchSubject }] : []),
          { period: p.day, subject: userSubject },
        ])
        .onConflictDoNothing();

      // The lock order: the church's month, then the person's day.
      const churchRow = churchSubject ? await lockRow(tx, p.month, churchSubject) : null;
      const userRow = await lockRow(tx, p.day, userSubject);

      let monthUsed: number | null = null;
      if (churchRow) {
        monthUsed = await take(tx, churchRow.id, input.monthlyLimit);
        if (monthUsed === null) throw new LimitReached("monthlyLimit", input.monthlyLimit ?? 0);
      }
      const dayUsed = await take(tx, userRow.id, input.dailyLimit);
      if (dayUsed === null) throw new LimitReached("dailyLimit", input.dailyLimit);
      return { churchRowId: churchRow?.id ?? null, userRowId: userRow.id, monthUsed, dayUsed };
    });
    return { ok: true, claim };
  } catch (e) {
    if (e instanceof LimitReached) return { ok: false, code: e.code, limit: e.limit };
    throw e;
  }
}

/**
 * Hand a claimed question back. Never below zero (the check constraint would
 * refuse it, and a refund must never fail). Same lock order as a claim, one
 * row at a time, so a refund and a claim cannot deadlock.
 */
export async function refundAssistantQuestion(claim: Pick<UsageClaim, "churchRowId" | "userRowId">): Promise<void> {
  await db.transaction(async (tx) => {
    for (const id of [claim.churchRowId, claim.userRowId]) {
      if (!id) continue;
      await tx
        .update(assistantUsage)
        .set({ used: sql`greatest(${assistantUsage.used} - 1, 0)` })
        .where(eq(assistantUsage.id, id));
    }
  });
}

/** This month's count for a church and today's for a person. Read-only; missing rows read as 0. */
export async function readAssistantUsage(input: {
  churchId: string | null;
  userId: string;
  now?: Date;
}): Promise<{ monthUsed: number | null; dayUsed: number }> {
  const p = usagePeriods(input.now ?? new Date());
  const churchSubject = input.churchId ? churchUsageSubject(input.churchId) : null;
  const userSubject = userUsageSubject(input.userId);
  const rows = await db
    .select({ period: assistantUsage.period, subject: assistantUsage.subject, used: assistantUsage.used })
    .from(assistantUsage)
    .where(
      and(
        inArray(assistantUsage.subject, churchSubject ? [churchSubject, userSubject] : [userSubject]),
        inArray(assistantUsage.period, [p.month, p.day]),
      ),
    );
  const find = (period: string, subject: string) =>
    rows.find((r) => r.period === period && r.subject === subject)?.used ?? 0;
  return {
    monthUsed: churchSubject ? find(p.month, churchSubject) : null,
    dayUsed: find(p.day, userSubject),
  };
}
