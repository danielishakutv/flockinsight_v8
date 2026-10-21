import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiChurchSetting, church, type AiFeature } from "@/db/schema";
import { aiConfigured, FEATURE_POLICY } from "./config";
import { callModel, classifyModelError, FALLBACK_BETA } from "./client";
import { getAiPlatformState } from "./settings";
import { BudgetRefused, reserve, settle, sweepAbandoned } from "./budget";
import { priceUsage, reservationFor } from "./pricing";
import { PAYLOAD_CLOSE, PAYLOAD_PREAMBLE, PROMPTS, type PromptId } from "./prompts";
import { AiPayloadRejected, revalidatePayload } from "./serialiser";
import { scrubFreeText } from "./safe-text";
import {
  interpretResponse,
  isPayloadShaped,
  isTextShaped,
  usageOf,
  validateRunInput,
  type AiContent,
  type AiUsage,
  type RunAiInput,
  type WireBody,
} from "./run-ai-rules";
import type { AiReason } from "./ai-shared";

export type { AiReason } from "./ai-shared";
export type { RunAiInput, AiUsage, AiContent } from "./run-ai-rules";
export type { AiModel } from "./config";

export type RunAiResult =
  | { ok: true; text: string; usage: AiUsage; callId: string; costNano: number }
  | { ok: false; reason: AiReason; message: string; callId?: string };

type Refusal = { ok: false; reason: AiReason; message: string };

/**
 * The cheap refusals, in order, with nothing written for any of them: no key,
 * the kill switch, a paused feature, and (for a church) no opt-in or the demo.
 * Exported as aiReadiness so a page can say "turned off" before anyone types.
 */
export async function aiReadiness(input: {
  churchId: string | null;
  feature: AiFeature;
}): Promise<{ ready: true } | Refusal> {
  if (!aiConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "AI is not switched on for FlockInsight: the server has no ANTHROPIC_API_KEY. Nothing was sent.",
    };
  }
  const state = await getAiPlatformState();
  if (state.killed) {
    return { ok: false, reason: "killed", message: "AI is stopped by the platform kill switch. Nothing was sent." };
  }
  if (state.pausedFeatures.includes(input.feature)) {
    return {
      ok: false,
      reason: "feature_paused",
      message: `The ${input.feature} AI feature is paused in /superadmin/ai. Nothing was sent.`,
    };
  }
  if (input.churchId) {
    const [row] = await db
      .select({ isDemo: church.isDemo, enabled: aiChurchSetting.enabled })
      .from(church)
      .leftJoin(aiChurchSetting, eq(aiChurchSetting.churchId, church.id))
      .where(eq(church.id, input.churchId))
      .limit(1);
    // The demo church resets every two hours and strangers on /try use it:
    // they must never spend the budget, whatever its settings say.
    if (!row || row.isDemo) {
      return {
        ok: false,
        reason: "not_opted_in",
        message: "AI is switched off for the demo church. Nothing was sent.",
      };
    }
    if (row.enabled !== true) {
      return {
        ok: false,
        reason: "not_opted_in",
        message: "This church's owner has not turned on AI. Nothing was sent.",
      };
    }
  }
  return { ready: true };
}

function contentToWire(c: AiContent, maxChars: number): { text: string; schema: string | null } {
  if (isPayloadShaped(c)) {
    // Re-validated in full against the registered schema, whatever object
    // this is and whichever module instance built it.
    const safe = revalidatePayload(c);
    return { text: PAYLOAD_PREAMBLE + safe.json + PAYLOAD_CLOSE, schema: safe.schema };
  }
  if (isTextShaped(c)) return { text: scrubFreeText(c.text, maxChars).text, schema: null };
  throw new AiPayloadRejected("$.content", "a serialised payload or scrubbed text");
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * THE entry point for every model call FlockInsight makes.
 *
 * Cheap refusals first (nothing written). Then the wire body is built from
 * re-validated payloads and re-scrubbed text, reserved against the month's
 * budgets and logged with its exact bytes BEFORE it is sent, sent once (no
 * SDK retries, so one row is one request), and settled with the measured cost.
 * Refusals, truncations and errors are recorded and billed like anything else.
 *
 * The kill switch stops NEW calls. One already in flight finishes within its
 * feature's timeout.
 */
export async function runAi(input: RunAiInput): Promise<RunAiResult> {
  const valid = validateRunInput(input);
  if (!valid.ok) {
    console.error("[ai] runAi refused an invalid request (a programming error):", valid.message);
    return { ok: false, reason: "invalid_input", message: valid.message };
  }

  const ready = await aiReadiness({ churchId: input.churchId, feature: input.feature });
  if ("ok" in ready) return ready;

  const policy = FEATURE_POLICY[input.feature];
  const state = await getAiPlatformState();

  let body: WireBody;
  let payloadSchema: string | null = null;
  try {
    const messages = input.messages.map((m) => {
      const w = contentToWire(m.content, policy.maxRequestBytes);
      if (w.schema) payloadSchema = payloadSchema ?? w.schema;
      return { role: m.role, content: w.text };
    });
    body = {
      model: input.model,
      max_tokens: input.maxTokens,
      system: PROMPTS[input.promptId],
      messages,
    };
    if (input.model === "claude-haiku-5-5") {
      // Haiku 5.5 defaults to medium effort; a short briefing needs low.
      body.output_config = { effort: "low" };
    }
  } catch (e) {
    if (e instanceof AiPayloadRejected) {
      return {
        ok: false,
        reason: "payload_rejected",
        message: `The payload was refused at ${e.path} (expected ${e.expected}). Nothing was sent.`,
      };
    }
    throw e;
  }

  // Server-side fallback is Sonnet-only; Haiku has none.
  const withFallback = input.model === "claude-sonnet-5-5";
  if (withFallback) body.fallbacks = "default";
  const betas = withFallback ? [FALLBACK_BETA] : undefined;

  const requestJson = JSON.stringify(betas ? { body, betas } : { body });
  const bytes = Buffer.byteLength(requestJson, "utf8");
  if (bytes > policy.maxRequestBytes) {
    return {
      ok: false,
      reason: "payload_rejected",
      message: `The request is ${bytes} bytes, over the ${policy.maxRequestBytes}-byte limit for ${input.feature}. Nothing was sent.`,
    };
  }
  const sha = sha256(requestJson);
  const reservedNano = reservationFor(input.model, bytes, input.maxTokens, { withFallback });

  let callId: string;
  try {
    await sweepAbandoned();
    ({ callId } = await reserve({
      churchId: input.churchId,
      feature: input.feature,
      promptId: input.promptId,
      payloadSchema,
      model: input.model,
      requestJson,
      sha,
      reservedNano,
      actorUserId: input.actorUserId,
      platformCeilingNano: state.platformCeilingNano,
      churchShareNano: state.churchShareNano,
    }));
  } catch (e) {
    if (e instanceof BudgetRefused) {
      return e.reason === "platform_budget"
        ? {
            ok: false,
            reason: "platform_budget",
            message: `This month's AI ceiling of $${state.platformCeilingUsd.toFixed(2)} has been reached. AI resumes on the 1st (UTC).`,
          }
        : {
            ok: false,
            reason: "church_budget",
            message: `This church's AI share of $${state.churchShareUsd.toFixed(2)} for the month has been used. It resets on the 1st (UTC).`,
          };
    }
    throw e;
  }

  const started = Date.now();
  let msg;
  try {
    msg = await callModel({ body, betas, timeoutMs: policy.timeoutMs });
  } catch (e) {
    const err = classifyModelError(e);
    const durationMs = Date.now() - started;
    const message =
      err.kind === "auth"
        ? "The AI key on the server was refused (401). Check ANTHROPIC_API_KEY."
        : err.kind === "rate_limit"
          ? "Anthropic is rate-limiting us. Try again in a few minutes."
          : err.kind === "timeout"
            ? `The AI request timed out after ${Math.round(policy.timeoutMs / 1000)} s. It may still have been billed, so it is charged at its reservation.`
            : err.kind === "bad_request"
              ? `Anthropic refused the request as malformed (400): ${err.message}`
              : `The AI provider failed${err.status ? ` (${err.status})` : ""}: ${err.message}`;
    console.error(`[ai] ${input.feature} call ${callId} failed (${err.kind}):`, err.message);
    // A timed-out request may still have been billed; a failed one is not.
    await settle(callId, {
      status: "error",
      costNano: err.kind === "timeout" ? reservedNano : 0,
      error: `${err.kind}: ${err.message}`.slice(0, 2000),
      durationMs,
    });
    return { ok: false, reason: "provider_error", message, callId };
  }

  const durationMs = Date.now() - started;
  const out = interpretResponse(msg);
  const usage = usageOf(msg.usage);
  const costNano = priceUsage(input.model, msg.usage);
  const status = out.kind === "ok" ? "ok" : out.kind === "refused" ? "refused" : out.kind === "truncated" ? "truncated" : "error";
  await settle(callId, {
    status,
    costNano,
    servedModel: msg.model ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    responseText: out.text || null,
    stopReason: msg.stop_reason ?? null,
    refusalCategory: out.kind === "refused" ? out.category : null,
    providerRequestId: msg._request_id ?? null,
    error: out.kind === "provider_error" ? out.message : null,
    durationMs,
  });

  switch (out.kind) {
    case "ok":
      return { ok: true, text: out.text, usage, callId, costNano };
    case "refused":
      return {
        ok: false,
        reason: "refused",
        message: `The model declined this request${out.category ? ` (category: ${out.category})` : ""}.`,
        callId,
      };
    case "truncated":
      return {
        ok: false,
        reason: "truncated",
        message: `The answer ran past ${input.maxTokens} tokens and was cut off, so it was not used.`,
        callId,
      };
    default:
      console.error(`[ai] ${input.feature} call ${callId}: ${out.message}`);
      return { ok: false, reason: "provider_error", message: `The AI provider returned ${out.message}.`, callId };
  }
}

/** Re-exported so a caller can type its prompt id from the one import. */
export type { PromptId };
