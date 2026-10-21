import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiCall, aiSummary, church } from "@/db/schema";
import { churchToday } from "@/lib/church-today";
import { isLocale, type LocaleCode } from "@/lib/i18n/locales";
import { monthKey } from "./budget-rules";
import { MODELS, aiConfigured } from "./config";
import { churchAiAvailability, getAiPlatformState } from "./settings";
import { runAi } from "./run-ai";
import { AiPayloadRejected, serialise, type SafePayload } from "./serialiser";
import { loadChurchFactsRaw } from "./church-facts";
import { isTooThinForSummary, toChurchFacts } from "./church-facts-shared";
import { loadPlatformFactsRaw } from "./platform-facts";
import { toPlatformFacts } from "./platform-facts-shared";
import type {
  ChurchSummaryView,
  PlatformSummaryView,
  SummaryLatest,
  SummaryToday,
  UiReason,
} from "./ai-shared";

/*
 * Plain-language summaries: at most one per subject (a church, or
 * 'platform') per local day, claimed BEFORE any model is called.
 *
 * The claim is INSERT ... ON CONFLICT DO NOTHING RETURNING against
 * unique(subject, day): the unique index is the rule that stops two staff
 * pressing the button at once from paying for two summaries. A retry after a
 * failure is an UPDATE whose predicate repeats the status and attempts that
 * were seen, with the returning() length checked, so two retries cannot both
 * win.
 */

export const PLATFORM_SUBJECT = "platform";
export const PLATFORM_TIMEZONE = "Africa/Lagos";
export const MAX_ATTEMPTS_PER_DAY = 3;
/** A pending claim older than this was abandoned mid-run and may be retried. */
export const PENDING_STALE_MS = 5 * 60_000;

export type GenerateResult<V> =
  | { ok: true; view: V }
  | { ok: false; reason: UiReason; message: string; view: V };

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function latestReady(subject: string): Promise<SummaryLatest | null> {
  const [row] = await db
    .select({ text: aiSummary.text, day: aiSummary.day, reusedFromId: aiSummary.reusedFromId })
    .from(aiSummary)
    .where(and(eq(aiSummary.subject, subject), eq(aiSummary.status, "ready")))
    .orderBy(desc(aiSummary.day))
    .limit(1);
  if (!row?.text) return null;
  return { text: row.text, day: row.day, reused: row.reusedFromId !== null };
}

async function todayRow(subject: string, day: string): Promise<SummaryToday | null> {
  const [row] = await db
    .select({ status: aiSummary.status, reason: aiSummary.reason, attempts: aiSummary.attempts })
    .from(aiSummary)
    .where(and(eq(aiSummary.subject, subject), eq(aiSummary.day, day)))
    .limit(1);
  return row ? { status: row.status, reason: row.reason, attempts: row.attempts } : null;
}

type Claim =
  | { kind: "claimed"; id: string }
  | { kind: "ready" }
  | { kind: "in_progress" }
  | { kind: "tried_today" };

async function claimDay(input: {
  subject: string;
  churchId: string | null;
  day: string;
  locale: string;
  actorUserId: string;
}): Promise<Claim> {
  const [fresh] = await db
    .insert(aiSummary)
    .values({
      subject: input.subject,
      churchId: input.churchId,
      day: input.day,
      status: "pending",
      attempts: 1,
      locale: input.locale,
      requestedByUserId: input.actorUserId,
    })
    .onConflictDoNothing()
    .returning({ id: aiSummary.id });
  if (fresh) return { kind: "claimed", id: fresh.id };

  const [seen] = await db
    .select({
      id: aiSummary.id,
      status: aiSummary.status,
      attempts: aiSummary.attempts,
      updatedAt: aiSummary.updatedAt,
    })
    .from(aiSummary)
    .where(and(eq(aiSummary.subject, input.subject), eq(aiSummary.day, input.day)))
    .limit(1);
  // The row that blocked the insert vanished (its church was deleted): treat
  // it as busy rather than guess.
  if (!seen) return { kind: "in_progress" };
  if (seen.status === "ready") return { kind: "ready" };
  const stale = Date.now() - seen.updatedAt.getTime() > PENDING_STALE_MS;
  if (seen.status === "pending" && !stale) return { kind: "in_progress" };
  if (seen.attempts >= MAX_ATTEMPTS_PER_DAY) return { kind: "tried_today" };

  const won = await db
    .update(aiSummary)
    .set({
      status: "pending",
      attempts: seen.attempts + 1,
      locale: input.locale,
      reason: null,
      requestedByUserId: input.actorUserId,
    })
    .where(
      and(
        eq(aiSummary.id, seen.id),
        eq(aiSummary.status, seen.status),
        eq(aiSummary.attempts, seen.attempts),
      ),
    )
    .returning({ id: aiSummary.id });
  return won.length === 1 ? { kind: "claimed", id: seen.id } : { kind: "in_progress" };
}

async function finish(
  id: string,
  fields: {
    status: "ready" | "failed" | "skipped";
    text?: string | null;
    reason?: string | null;
    callId?: string | null;
    payloadSha256?: string | null;
    reusedFromId?: string | null;
  },
): Promise<void> {
  await db.update(aiSummary).set(fields).where(eq(aiSummary.id, id));
}

/**
 * Steps 4–7 of a generation, shared by the church and platform summaries:
 * build the payload, reuse an identical day's text for free, otherwise call
 * the model, and write the outcome onto the claimed row.
 */
async function writeSummary(input: {
  claimId: string;
  subject: string;
  churchId: string | null;
  locale: string;
  actorUserId: string;
  buildPayload: () => Promise<SafePayload | "thin">;
  promptId: "analytics-church@1" | "analytics-platform@1";
}): Promise<{ ok: true } | { ok: false; reason: UiReason; message: string }> {
  try {
    let payload: SafePayload | "thin";
    try {
      payload = await input.buildPayload();
    } catch (e) {
      if (e instanceof AiPayloadRejected) {
        console.error(`[ai] summary payload rejected for ${input.subject}:`, e.message);
        await finish(input.claimId, { status: "failed", reason: "payload_rejected" });
        return { ok: false, reason: "payload_rejected", message: e.message };
      }
      throw e;
    }
    if (payload === "thin") {
      await finish(input.claimId, { status: "skipped", reason: "thin_data" });
      return { ok: false, reason: "thin_data", message: "Too few records to summarise yet." };
    }

    const payloadSha256 = sha256(payload.json);
    // Unchanged figures cost nothing: the same payload already has text.
    const [same] = await db
      .select({ id: aiSummary.id, text: aiSummary.text })
      .from(aiSummary)
      .where(
        and(
          eq(aiSummary.subject, input.subject),
          eq(aiSummary.status, "ready"),
          eq(aiSummary.payloadSha256, payloadSha256),
          eq(aiSummary.locale, input.locale),
          ne(aiSummary.id, input.claimId),
        ),
      )
      .orderBy(desc(aiSummary.day))
      .limit(1);
    if (same?.text) {
      await finish(input.claimId, { status: "ready", text: same.text, payloadSha256, reusedFromId: same.id });
      return { ok: true };
    }

    const result = await runAi({
      churchId: input.churchId,
      feature: "analytics",
      model: MODELS.haiku,
      promptId: input.promptId,
      messages: [{ role: "user", content: payload }],
      maxTokens: 4000,
      actorUserId: input.actorUserId,
    });
    if (result.ok) {
      await finish(input.claimId, {
        status: "ready",
        text: result.text.trim(),
        callId: result.callId,
        payloadSha256,
      });
      return { ok: true };
    }
    await finish(input.claimId, {
      status: "failed",
      reason: result.reason,
      callId: result.callId ?? null,
      payloadSha256,
    });
    return { ok: false, reason: result.reason, message: result.message };
  } catch (e) {
    // Never leave the day stuck at pending for its full stale window.
    console.error(`[ai] summary for ${input.subject} failed unexpectedly:`, e);
    await finish(input.claimId, { status: "failed", reason: "provider_error" });
    return {
      ok: false,
      reason: "provider_error",
      message: `The summary could not be written: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Church summaries
 * ------------------------------------------------------------------ */

async function churchContext(churchId: string) {
  const [row] = await db
    .select({ timezone: church.timezone, defaultLocale: church.defaultLocale })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  const day = churchToday(row?.timezone ?? null);
  const dl = row?.defaultLocale;
  const locale: LocaleCode = isLocale(dl) ? dl : "en";
  return { day, locale };
}

async function churchMonthCount(churchId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(aiCall)
    .where(
      and(
        eq(aiCall.churchId, churchId),
        eq(aiCall.feature, "analytics"),
        eq(aiCall.budgetMonth, monthKey()),
        eq(aiCall.status, "ok"),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Read-only: calls no model and claims nothing, so rendering a page is free. */
export async function getChurchSummaryView(churchId: string): Promise<ChurchSummaryView> {
  const { day } = await churchContext(churchId);
  const [latest, today, availability, monthCount] = await Promise.all([
    latestReady(churchId),
    todayRow(churchId, day),
    churchAiAvailability(churchId),
    churchMonthCount(churchId),
  ]);
  return { latest, today, availability, monthCount };
}

async function buildChurchPayload(churchId: string, locale: LocaleCode): Promise<SafePayload | "thin"> {
  const raw = await loadChurchFactsRaw(churchId);
  if (isTooThinForSummary(raw)) return "thin";
  return serialise("church-facts@1", toChurchFacts(raw, locale));
}

/**
 * Write today's summary for a church, in the church's language. The church id
 * must come from the session, never from input.
 */
export async function generateChurchSummary(
  churchId: string,
  actorUserId: string,
): Promise<GenerateResult<ChurchSummaryView>> {
  const { day, locale } = await churchContext(churchId);
  const a = await churchAiAvailability(churchId);
  const refuse = async (reason: UiReason, message: string): Promise<GenerateResult<ChurchSummaryView>> => ({
    ok: false,
    reason,
    message,
    view: await getChurchSummaryView(churchId),
  });

  // Any "no" returns its own reason without claiming the day.
  if (!a.configured) return refuse("not_configured", "The server has no ANTHROPIC_API_KEY.");
  if (a.killed) return refuse("killed", "AI is stopped by the platform kill switch.");
  if (a.analyticsPaused) return refuse("feature_paused", "AI summaries are paused in /superadmin/ai.");
  if (a.isDemo) return refuse("not_opted_in", "AI summaries are switched off on the demo church.");
  if (!a.optedIn) return refuse("not_opted_in", "The church owner has not turned on AI summaries.");
  if (!a.onPlan) return refuse("invalid_input", "This church's plan does not include AI summaries.");

  const claim = await claimDay({ subject: churchId, churchId, day, locale, actorUserId });
  if (claim.kind === "ready") return { ok: true, view: await getChurchSummaryView(churchId) };
  if (claim.kind === "in_progress") return refuse("in_progress", "A summary is already being written.");
  if (claim.kind === "tried_today") return refuse("tried_today", "Three attempts have been made today.");

  const out = await writeSummary({
    claimId: claim.id,
    subject: churchId,
    churchId,
    locale,
    actorUserId,
    buildPayload: () => buildChurchPayload(churchId, locale),
    promptId: "analytics-church@1",
  });
  const view = await getChurchSummaryView(churchId);
  return out.ok ? { ok: true, view } : { ...out, view };
}

/**
 * Exactly what would leave today, without claiming the day or calling a
 * model, so the owner can read it before consenting. On a rejection only the
 * path is returned, never the value.
 */
export async function previewChurchPayload(
  churchId: string,
): Promise<{ ok: true; json: string } | { ok: false; path: string }> {
  const { locale } = await churchContext(churchId);
  try {
    const raw = await loadChurchFactsRaw(churchId);
    const payload = serialise("church-facts@1", toChurchFacts(raw, locale));
    return { ok: true, json: JSON.stringify(JSON.parse(payload.json), null, 2) };
  } catch (e) {
    if (e instanceof AiPayloadRejected) {
      console.error(`[ai] preview payload rejected for church ${churchId}:`, e.message);
      return { ok: false, path: e.path };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * The platform summary (superadmin). Counts only against the platform
 * budget row; church opt-in does not apply, because no church's data is in it.
 * ------------------------------------------------------------------ */

async function platformAvailability() {
  const state = await getAiPlatformState();
  return {
    configured: aiConfigured(),
    killed: state.killed,
    analyticsPaused: state.pausedFeatures.includes("analytics"),
  };
}

export async function getPlatformSummaryView(): Promise<PlatformSummaryView> {
  const day = churchToday(PLATFORM_TIMEZONE);
  const [latest, today, availability, [row]] = await Promise.all([
    latestReady(PLATFORM_SUBJECT),
    todayRow(PLATFORM_SUBJECT, day),
    platformAvailability(),
    db
      .select({ n: sql<string>`count(*)` })
      .from(aiCall)
      .where(
        and(
          isNull(aiCall.churchId),
          eq(aiCall.promptId, "analytics-platform@1"),
          eq(aiCall.budgetMonth, monthKey()),
          eq(aiCall.status, "ok"),
        ),
      ),
  ]);
  return { latest, today, availability, monthCount: Number(row?.n ?? 0) };
}

export async function generatePlatformSummary(actorUserId: string): Promise<GenerateResult<PlatformSummaryView>> {
  const day = churchToday(PLATFORM_TIMEZONE);
  const a = await platformAvailability();
  const refuse = async (reason: UiReason, message: string): Promise<GenerateResult<PlatformSummaryView>> => ({
    ok: false,
    reason,
    message,
    view: await getPlatformSummaryView(),
  });
  if (!a.configured) return refuse("not_configured", "AI is dormant: the server has no ANTHROPIC_API_KEY. Nothing was sent.");
  if (a.killed) return refuse("killed", "AI is stopped by the kill switch in /superadmin/ai. Nothing was sent.");
  if (a.analyticsPaused) return refuse("feature_paused", "The analytics AI feature is paused in /superadmin/ai.");

  const claim = await claimDay({ subject: PLATFORM_SUBJECT, churchId: null, day, locale: "en", actorUserId });
  if (claim.kind === "ready") return { ok: true, view: await getPlatformSummaryView() };
  if (claim.kind === "in_progress") return refuse("in_progress", "A summary is already being written. Refresh in a minute.");
  if (claim.kind === "tried_today") return refuse("tried_today", "Three attempts have been made today. Try again tomorrow.");

  const out = await writeSummary({
    claimId: claim.id,
    subject: PLATFORM_SUBJECT,
    churchId: null,
    locale: "en",
    actorUserId,
    buildPayload: async () => serialise("platform-facts@1", toPlatformFacts(await loadPlatformFactsRaw())),
    promptId: "analytics-platform@1",
  });
  const view = await getPlatformSummaryView();
  return out.ok ? { ok: true, view } : { ...out, view };
}
