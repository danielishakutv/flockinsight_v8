import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiBudgetMonth, aiCall, type AiCallStatus, type AiFeature } from "@/db/schema";
import { STALE_AFTER_MS, monthKey } from "./budget-rules";

/*
 * The claim path for AI money, built to AGENTS.md's rule for claims: a
 * READ COMMITTED transaction alone does not stop two requests both seeing
 * headroom and both spending it.
 *
 *   1. SELECT ... FOR UPDATE on the ai_budget_month row (the single contested
 *      row; unique(month, subject) guarantees there is exactly one);
 *   2. the ceiling repeated as a predicate in the UPDATE that adds the
 *      reservation, with the returning() length checked;
 *   3. the rows themselves are created up front with ON CONFLICT DO NOTHING.
 *
 * Lock order everywhere: the 'platform' row, then the church row, then the
 * ai_call row. Two transactions therefore cannot deadlock. No lock is ever held
 * across the HTTP request: reserve() commits before the call, settle() opens a
 * new transaction after it.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PLATFORM_SUBJECT = "platform";

export class BudgetRefused extends Error {
  readonly reason: "platform_budget" | "church_budget";
  constructor(reason: "platform_budget" | "church_budget") {
    super(
      reason === "platform_budget"
        ? "This month's platform AI ceiling has been reached."
        : "This church's AI share for the month has been used.",
    );
    this.name = "BudgetRefused";
    this.reason = reason;
  }
}

async function ensureRows(tx: Tx, month: string, churchId: string | null): Promise<void> {
  const rows = [{ month, subject: PLATFORM_SUBJECT }];
  if (churchId) rows.push({ month, subject: churchId });
  await tx.insert(aiBudgetMonth).values(rows).onConflictDoNothing();
}

/** Platform row first, then the church row: the lock order. */
async function lockBudgetRows(
  tx: Tx,
  month: string,
  churchId: string | null,
): Promise<{ platformId: string | null; churchRowId: string | null }> {
  const [p] = await tx
    .select({ id: aiBudgetMonth.id })
    .from(aiBudgetMonth)
    .where(and(eq(aiBudgetMonth.month, month), eq(aiBudgetMonth.subject, PLATFORM_SUBJECT)))
    .for("update");
  let c: { id: string } | undefined;
  if (churchId) {
    [c] = await tx
      .select({ id: aiBudgetMonth.id })
      .from(aiBudgetMonth)
      .where(and(eq(aiBudgetMonth.month, month), eq(aiBudgetMonth.subject, churchId)))
      .for("update");
  }
  return { platformId: p?.id ?? null, churchRowId: c?.id ?? null };
}

/** Add a reservation if, and only if, it still fits. The predicate is the ceiling. */
async function addReservation(tx: Tx, rowId: string, amount: number, ceiling: number): Promise<boolean> {
  const won = await tx
    .update(aiBudgetMonth)
    .set({
      reservedNano: sql`${aiBudgetMonth.reservedNano} + ${amount}`,
      calls: sql`${aiBudgetMonth.calls} + 1`,
    })
    .where(
      and(
        eq(aiBudgetMonth.id, rowId),
        sql`${aiBudgetMonth.spentNano} + ${aiBudgetMonth.reservedNano} + ${amount} <= ${ceiling}`,
      ),
    )
    .returning({ id: aiBudgetMonth.id });
  return won.length === 1;
}

/**
 * Move `reserved` out of reserved and `spent` into spent. Never refuses:
 * greatest(…, 0) keeps the nonneg check satisfied even if a row drifted, so a
 * measured cost can always be written. A call missing from the ledger is worse
 * than a ledger that is briefly conservative.
 */
async function moveMoney(tx: Tx, rowId: string | null, releaseReserved: number, addSpent: number): Promise<void> {
  if (!rowId) return;
  await tx
    .update(aiBudgetMonth)
    .set({
      reservedNano: sql`greatest(${aiBudgetMonth.reservedNano} - ${releaseReserved}, 0)`,
      spentNano: sql`greatest(${aiBudgetMonth.spentNano} + ${addSpent}, 0)`,
    })
    .where(eq(aiBudgetMonth.id, rowId));
}

export type ReserveInput = {
  churchId: string | null;
  feature: AiFeature;
  promptId: string;
  payloadSchema: string | null;
  model: string;
  requestJson: string;
  sha: string;
  reservedNano: number;
  actorUserId: string | null;
  platformCeilingNano: number;
  churchShareNano: number;
  now?: Date;
};

/**
 * Hold the worst case against the month's budgets and write the ai_call row
 * with the exact request, all in one transaction that commits BEFORE any
 * network call. Throws BudgetRefused (rolled back, nothing written) when it
 * does not fit.
 */
export async function reserve(input: ReserveInput): Promise<{ callId: string; budgetMonth: string }> {
  const month = monthKey(input.now ?? new Date());
  return db.transaction(async (tx) => {
    await ensureRows(tx, month, input.churchId);
    const { platformId, churchRowId } = await lockBudgetRows(tx, month, input.churchId);
    if (!platformId) throw new Error("The platform AI budget row is missing after it was created. Check ai_budget_month.");
    if (!(await addReservation(tx, platformId, input.reservedNano, input.platformCeilingNano))) {
      throw new BudgetRefused("platform_budget");
    }
    if (input.churchId) {
      if (!churchRowId) throw new Error("The church AI budget row is missing after it was created. Check ai_budget_month.");
      if (!(await addReservation(tx, churchRowId, input.reservedNano, input.churchShareNano))) {
        throw new BudgetRefused("church_budget");
      }
    }
    const [row] = await tx
      .insert(aiCall)
      .values({
        churchId: input.churchId,
        feature: input.feature,
        promptId: input.promptId,
        payloadSchema: input.payloadSchema,
        model: input.model,
        status: "reserved",
        actorUserId: input.actorUserId,
        budgetMonth: month,
        reservedNano: input.reservedNano,
        requestJson: input.requestJson,
        requestSha256: input.sha,
      })
      .returning({ id: aiCall.id });
    return { callId: row.id, budgetMonth: month };
  });
}

export type SettleOutcome = {
  status: Exclude<AiCallStatus, "reserved" | "abandoned">;
  costNano: number;
  servedModel?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheWriteTokens?: number | null;
  cacheReadTokens?: number | null;
  responseText?: string | null;
  stopReason?: string | null;
  refusalCategory?: string | null;
  providerRequestId?: string | null;
  error?: string | null;
  durationMs?: number | null;
};

/**
 * Write the final status and the measured cost, and move the money from
 * reserved to spent. Never refuses. If the sweep already marked the call
 * abandoned (charged at its reservation), only the difference is applied.
 */
export async function settle(callId: string, outcome: SettleOutcome): Promise<void> {
  // church_id and budget_month never change after insert, so reading them
  // unlocked to know which budget rows to lock first is safe.
  const [meta] = await db
    .select({ churchId: aiCall.churchId, budgetMonth: aiCall.budgetMonth })
    .from(aiCall)
    .where(eq(aiCall.id, callId))
    .limit(1);
  if (!meta) {
    console.error("[ai] settle: no ai_call row for this id; the cost could not be recorded.", { callId });
    return;
  }
  const cost = Math.max(0, Math.ceil(outcome.costNano));
  await db.transaction(async (tx) => {
    const { platformId, churchRowId } = await lockBudgetRows(tx, meta.budgetMonth, meta.churchId);
    const [call] = await tx
      .select({ status: aiCall.status, reservedNano: aiCall.reservedNano })
      .from(aiCall)
      .where(eq(aiCall.id, callId))
      .for("update");
    if (!call) return;
    const fields = {
      status: outcome.status,
      costNano: cost,
      servedModel: outcome.servedModel ?? null,
      inputTokens: outcome.inputTokens ?? null,
      outputTokens: outcome.outputTokens ?? null,
      cacheWriteTokens: outcome.cacheWriteTokens ?? null,
      cacheReadTokens: outcome.cacheReadTokens ?? null,
      responseText: outcome.responseText ?? null,
      stopReason: outcome.stopReason ?? null,
      refusalCategory: outcome.refusalCategory ?? null,
      providerRequestId: outcome.providerRequestId ?? null,
      error: outcome.error ?? null,
      durationMs: outcome.durationMs ?? null,
      settledAt: new Date(),
    };
    if (call.status === "reserved") {
      const done = await tx
        .update(aiCall)
        .set(fields)
        .where(and(eq(aiCall.id, callId), eq(aiCall.status, "reserved")))
        .returning({ id: aiCall.id });
      if (done.length !== 1) return;
      await moveMoney(tx, platformId, call.reservedNano, cost);
      await moveMoney(tx, churchRowId, call.reservedNano, cost);
    } else if (call.status === "abandoned") {
      // The sweep already released the reservation and charged it in full.
      const done = await tx
        .update(aiCall)
        .set(fields)
        .where(and(eq(aiCall.id, callId), eq(aiCall.status, "abandoned")))
        .returning({ id: aiCall.id });
      if (done.length !== 1) return;
      const delta = cost - call.reservedNano;
      await moveMoney(tx, platformId, 0, delta);
      await moveMoney(tx, churchRowId, 0, delta);
    } else {
      console.error("[ai] settle: the call was already settled; the second outcome was not applied.", {
        callId,
        status: call.status,
      });
    }
  });
}

/**
 * Charge calls that never settled (the process died mid-call) at their full
 * reservation, which is conservative because the real cost is unknown. One
 * transaction per row, so a crash leaves either the old state or the new one,
 * never a call marked abandoned with its money still held.
 */
export async function sweepAbandoned(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const candidates = await db
    .select({ id: aiCall.id, churchId: aiCall.churchId, budgetMonth: aiCall.budgetMonth })
    .from(aiCall)
    .where(and(eq(aiCall.status, "reserved"), lt(aiCall.createdAt, cutoff)))
    .limit(20);
  let swept = 0;
  for (const c of candidates) {
    const done = await db.transaction(async (tx) => {
      const { platformId, churchRowId } = await lockBudgetRows(tx, c.budgetMonth, c.churchId);
      const [call] = await tx
        .select({ reservedNano: aiCall.reservedNano })
        .from(aiCall)
        .where(and(eq(aiCall.id, c.id), eq(aiCall.status, "reserved")))
        .for("update", { skipLocked: true });
      if (!call) return false;
      const marked = await tx
        .update(aiCall)
        .set({
          status: "abandoned",
          costNano: call.reservedNano,
          settledAt: new Date(),
          error: "Never settled within 15 minutes; charged at its reservation.",
        })
        .where(and(eq(aiCall.id, c.id), eq(aiCall.status, "reserved")))
        .returning({ id: aiCall.id });
      if (marked.length !== 1) return false;
      await moveMoney(tx, platformId, call.reservedNano, call.reservedNano);
      await moveMoney(tx, churchRowId, call.reservedNano, call.reservedNano);
      return true;
    });
    if (done) swept++;
  }
  return swept;
}
