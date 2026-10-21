/**
 * runAi's rules without the database or the network: what a valid request
 * looks like, and what a response means. Unit-tested on its own.
 */

import type { AiFeature } from "@/db/schema";
import { FEATURE_POLICY, type AiModel } from "./config";
import { PROMPT_SCOPE, isPromptId, type PromptId } from "./prompts";
import type { SafePayload } from "./serialiser";
import type { ScrubbedText } from "./safe-text";
import type { UsageLike } from "./pricing";

export type AiContent = SafePayload | ScrubbedText;

export type RunAiInput = {
  churchId: string | null;
  feature: AiFeature;
  model: AiModel;
  promptId: PromptId;
  messages: { role: "user" | "assistant"; content: AiContent }[];
  maxTokens: number;
  actorUserId: string | null;
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/** The parts of a Messages API response runAi reads. The SDK's types satisfy it. */
export type ModelResponse = {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
  usage: UsageLike;
  _request_id?: string | null;
};

/** The request body as sent: byte-for-byte what is logged in ai_call.requestJson. */
export type WireBody = {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  output_config?: { effort: "low" };
  fallbacks?: "default";
};

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isPayloadShaped(c: unknown): c is SafePayload {
  return isObject(c) && typeof c.schema === "string" && typeof c.json === "string";
}

export function isTextShaped(c: unknown): c is ScrubbedText {
  return isObject(c) && c.kind === "text" && typeof c.text === "string";
}

/**
 * A programming error, not a user error: everything here is decided by the
 * calling code. runAi logs a failure with console.error and writes nothing.
 */
export function validateRunInput(input: RunAiInput): { ok: true } | { ok: false; message: string } {
  const policy = FEATURE_POLICY[input.feature];
  if (!policy) return { ok: false, message: `Unknown AI feature "${String(input.feature)}".` };
  if (input.model !== policy.model) {
    return {
      ok: false,
      message: `The ${input.feature} feature may only use ${policy.model}, not ${String(input.model)}.`,
    };
  }
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > policy.maxTokens) {
    return {
      ok: false,
      message: `maxTokens must be a whole number from 1 to ${policy.maxTokens} for ${input.feature}.`,
    };
  }
  if (!isPromptId(input.promptId)) {
    return { ok: false, message: `Unknown prompt id "${String(input.promptId)}". Add it to lib/ai/prompts.ts.` };
  }
  const hasChurch = typeof input.churchId === "string" && input.churchId.length > 0;
  if (policy.churchScoped === "required" && !hasChurch) {
    return { ok: false, message: `The ${input.feature} feature needs a church id.` };
  }
  if (policy.churchScoped === "never" && hasChurch) {
    return { ok: false, message: `The ${input.feature} feature never runs for a church.` };
  }
  const scope = PROMPT_SCOPE[input.promptId];
  if (scope === "church" && !hasChurch) {
    return { ok: false, message: `Prompt ${input.promptId} needs a church id.` };
  }
  if (scope === "platform" && hasChurch) {
    return { ok: false, message: `Prompt ${input.promptId} is a platform prompt and takes no church id.` };
  }

  const msgs = input.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return { ok: false, message: "No messages to send." };
  for (let i = 0; i < msgs.length; i++) {
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (msgs[i]?.role !== expected) {
      return { ok: false, message: `Message ${i} must be "${expected}": turns alternate, starting with user.` };
    }
  }
  if (msgs[msgs.length - 1].role !== "user") {
    // These models refuse an assistant prefill with a 400; refuse it here, for free.
    return { ok: false, message: "The last message must be from the user (no assistant prefill)." };
  }

  let payloads = 0;
  let texts = 0;
  for (let i = 0; i < msgs.length; i++) {
    const c: unknown = msgs[i].content;
    if (isPayloadShaped(c)) payloads++;
    else if (isTextShaped(c)) {
      if (!policy.freeText) {
        return { ok: false, message: `The ${input.feature} feature never sends typed text (message ${i}).` };
      }
      texts++;
    } else {
      return {
        ok: false,
        message: `Message ${i} is neither a serialised payload nor scrubbed text. Use serialise() or scrubFreeText().`,
      };
    }
  }
  if (input.feature === "analytics" && (payloads === 0 || texts > 0)) {
    return { ok: false, message: "An analytics call needs at least one payload and no text." };
  }
  return { ok: true };
}

export type Interpreted =
  | { kind: "ok"; text: string }
  | { kind: "truncated"; text: string }
  | { kind: "refused"; text: string; category: string | null }
  | { kind: "provider_error"; text: string; message: string };

/** The concatenated text blocks. Thinking and fallback blocks are ignored. */
export function responseText(msg: Pick<ModelResponse, "content">): string {
  return (msg.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

export function interpretResponse(msg: ModelResponse): Interpreted {
  const text = responseText(msg);
  switch (msg.stop_reason) {
    case "end_turn":
    case "stop_sequence":
      if (!text.trim()) return { kind: "provider_error", text, message: "empty response" };
      return { kind: "ok", text };
    case "max_tokens":
    case "model_context_window_exceeded":
      return { kind: "truncated", text };
    case "refusal":
      return { kind: "refused", text, category: msg.stop_details?.category ?? null };
    default:
      return { kind: "provider_error", text, message: `unexpected stop_reason ${String(msg.stop_reason)}` };
  }
}

export function usageOf(u: UsageLike): AiUsage {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
  };
}
