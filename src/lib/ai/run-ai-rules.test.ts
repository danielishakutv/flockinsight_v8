import { describe, expect, it } from "vitest";
import { interpretResponse, validateRunInput, type ModelResponse, type RunAiInput } from "./run-ai-rules";
import { scrubFreeText } from "./safe-text";
import type { SafePayload } from "./serialiser";

const payload = { schema: "church-facts@1", json: "{}" } as unknown as SafePayload;
const text = scrubFreeText("How do I record attendance?", 500);

function input(over: Partial<RunAiInput> = {}): RunAiInput {
  return {
    churchId: "church_1",
    feature: "analytics",
    model: "claude-haiku-5-5",
    promptId: "analytics-church@1",
    messages: [{ role: "user", content: payload }],
    maxTokens: 4000,
    actorUserId: "user_1",
    ...over,
  };
}

const expectInvalid = (i: RunAiInput, fragment: string) => {
  const r = validateRunInput(i);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain(fragment);
};

describe("validateRunInput", () => {
  it("accepts a well-formed church analytics call", () => {
    expect(validateRunInput(input())).toEqual({ ok: true });
  });

  it("refuses a model the feature's policy does not allow", () => {
    expectInvalid(input({ model: "claude-sonnet-5-5" }), "may only use claude-haiku-5-5");
  });

  it("bounds maxTokens to 1..the policy maximum", () => {
    expectInvalid(input({ maxTokens: 0 }), "maxTokens");
    expectInvalid(input({ maxTokens: 4001 }), "maxTokens");
    expectInvalid(input({ maxTokens: 1.5 }), "maxTokens");
  });

  it("refuses an unknown prompt id", () => {
    expectInvalid(input({ promptId: "made-up@1" as never }), "Unknown prompt id");
  });

  it("refuses a trailing assistant turn (prefill) and non-alternating turns", () => {
    expectInvalid(
      input({
        messages: [
          { role: "user", content: payload },
          { role: "assistant", content: text },
        ],
      }),
      "no assistant prefill",
    );
    expectInvalid(
      input({
        messages: [
          { role: "user", content: payload },
          { role: "user", content: payload },
        ],
      }),
      "alternate",
    );
    expectInvalid(input({ messages: [{ role: "assistant", content: payload }] }), "alternate");
  });

  it("never lets typed text through analytics", () => {
    expectInvalid(input({ messages: [{ role: "user", content: text }] }), "never sends typed text");
  });

  it("refuses content that is neither a payload nor scrubbed text", () => {
    expectInvalid(
      input({ messages: [{ role: "user", content: "raw string" as never }] }),
      "neither a serialised payload nor scrubbed text",
    );
  });

  it("ties church ids to the prompt for analytics and to the policy for blog", () => {
    expectInvalid(input({ churchId: null }), "needs a church id");
    expectInvalid(input({ promptId: "analytics-platform@1" }), "takes no church id");
    expect(validateRunInput(input({ churchId: null, promptId: "analytics-platform@1" }))).toEqual({ ok: true });
    expectInvalid(
      input({
        feature: "blog",
        model: "claude-sonnet-5-5",
        maxTokens: 6000,
        promptId: "analytics-platform@1",
        messages: [{ role: "user", content: text }],
      }),
      "never runs for a church",
    );
  });
});

function msg(over: Partial<ModelResponse>): ModelResponse {
  return {
    model: "claude-haiku-5-5",
    stop_reason: "end_turn",
    stop_details: null,
    content: [{ type: "text", text: "Attendance is up." }],
    usage: { input_tokens: 10, output_tokens: 5 },
    ...over,
  };
}

describe("interpretResponse", () => {
  it("end_turn and stop_sequence are ok, joining only the text blocks", () => {
    const r = interpretResponse(
      msg({
        content: [
          { type: "thinking" },
          { type: "text", text: "Hello " },
          { type: "fallback" },
          { type: "text", text: "pastor." },
        ],
      }),
    );
    expect(r).toEqual({ kind: "ok", text: "Hello pastor." });
    expect(interpretResponse(msg({ stop_reason: "stop_sequence" })).kind).toBe("ok");
  });

  it("max_tokens and model_context_window_exceeded are truncated", () => {
    expect(interpretResponse(msg({ stop_reason: "max_tokens" })).kind).toBe("truncated");
    expect(interpretResponse(msg({ stop_reason: "model_context_window_exceeded" })).kind).toBe("truncated");
  });

  it("refusal reads the category when stop_details carries one, null otherwise", () => {
    expect(interpretResponse(msg({ stop_reason: "refusal", stop_details: { category: "cyber" } }))).toMatchObject({
      kind: "refused",
      category: "cyber",
    });
    expect(interpretResponse(msg({ stop_reason: "refusal", stop_details: null }))).toMatchObject({
      kind: "refused",
      category: null,
    });
  });

  it("tool_use, pause_turn and anything unknown are provider errors", () => {
    for (const s of ["tool_use", "pause_turn", "something_new", null]) {
      const r = interpretResponse(msg({ stop_reason: s }));
      expect(r.kind).toBe("provider_error");
    }
  });

  it("empty text on end_turn is a provider error, not a blank summary", () => {
    const r = interpretResponse(msg({ content: [{ type: "text", text: "   " }] }));
    expect(r).toMatchObject({ kind: "provider_error", message: "empty response" });
  });
});
