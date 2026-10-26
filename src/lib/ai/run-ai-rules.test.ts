import { describe, expect, it } from "vitest";
import { effortFor, interpretResponse, validateRunInput, type ModelResponse, type RunAiInput } from "./run-ai-rules";
import { FEATURE_POLICY, MODELS, WORKSPACE_FIX, isWorkspaceScopeError } from "./config";
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

describe("the advisor feature", () => {
  const advisor = (over: Partial<RunAiInput> = {}): RunAiInput =>
    input({
      feature: "advisor",
      promptId: "assistant-advisor-church@1",
      maxTokens: 2500,
      messages: [
        { role: "user", content: payload },
        { role: "assistant", content: scrubFreeText("I have the figures.", 100) },
        { role: "user", content: text },
      ],
      ...over,
    });

  it("takes the figures and a typed question in alternating turns, for a church or for none", () => {
    expect(validateRunInput(advisor())).toEqual({ ok: true });
    // A superadmin acting as a church asks with no church id: neither advisor prompt is scoped.
    expect(validateRunInput(advisor({ churchId: null }))).toEqual({ ok: true });
    expect(validateRunInput(advisor({ churchId: null, promptId: "assistant-advisor-platform@1" }))).toEqual({
      ok: true,
    });
  });

  it("is pinned to Haiku and its own ceiling", () => {
    expectInvalid(advisor({ model: "claude-sonnet-5-5" }), "may only use claude-haiku-5-5");
    expectInvalid(advisor({ maxTokens: 2501 }), "maxTokens");
    expect(FEATURE_POLICY.advisor).toMatchObject({
      model: MODELS.haiku,
      maxTokens: 2500,
      maxRequestBytes: 49_152,
      timeoutMs: 60_000,
      freeText: true,
      churchScoped: "optional",
    });
  });
});

describe("isWorkspaceScopeError", () => {
  it("recognises Anthropic's refusal of an organisation-level key, and nothing else", () => {
    expect(
      isWorkspaceScopeError(
        "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header",
      ),
    ).toBe(true);
    expect(isWorkspaceScopeError("Invalid value for anthropic-workspace-id")).toBe(true);
    expect(isWorkspaceScopeError("max_tokens: must be at most 64000")).toBe(false);
    expect(isWorkspaceScopeError("")).toBe(false);
  });

  it("tells the operator both fixes and how to restart so the new value is read", () => {
    expect(WORKSPACE_FIX).toContain("ANTHROPIC_WORKSPACE_ID");
    expect(WORKSPACE_FIX).toContain("ANTHROPIC_API_KEY");
    expect(WORKSPACE_FIX).toContain("--update-env");
  });
});

describe("effortFor", () => {
  it("keeps the briefings and the help assistant on low, as before", () => {
    expect(effortFor("analytics", MODELS.haiku)).toBe("low");
    expect(effortFor("chat", MODELS.haiku)).toBe("low");
  });

  it("gives the advisor medium, because it weighs figures and writes recommendations", () => {
    expect(effortFor("advisor", MODELS.haiku)).toBe("medium");
  });

  it("sends no effort to a model that takes none", () => {
    expect(effortFor("blog", MODELS.sonnet)).toBeNull();
    // Decided by the policy's model, not by what a caller asks for.
    expect(effortFor("advisor", MODELS.sonnet)).toBeNull();
  });

  it("gives every Haiku feature an effort, so none silently falls back to the model's default", () => {
    for (const [feature, policy] of Object.entries(FEATURE_POLICY)) {
      if (policy.model === MODELS.haiku) expect(policy.effort, feature).toBeDefined();
    }
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
