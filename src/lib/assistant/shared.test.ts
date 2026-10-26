import { describe, expect, expectTypeOf, it } from "vitest";
import { PROMPTS, PROMPT_SCOPE, isPromptId } from "@/lib/ai/prompts";
import {
  ASSISTANT_PROMPT_ID,
  ASSISTANT_SYSTEM_PROMPT,
  CANNED_DRAFT_PROMPT_ID,
  CANNED_DRAFT_SYSTEM_PROMPT,
  CONVERSATION_TITLE_MAX,
  HISTORY_TURNS,
  answerKindFor,
  buildAssistantUserTurn,
  buildCannedDraftPrompt,
  conversationTitle,
  dormantKeyFor,
  exchangesOf,
  type ChatAnswer,
  type ChatQuestion,
  groundedFromStored,
  historyForModel,
  isModelFailure,
  parseAnswer,
  parseCannedDraft,
  reviewStatusFor,
  safeAssistantHref,
} from "./shared";

const ID = "6f1d3c7e-2b4a-4c8e-9f00-1234567890ab";
const known = {
  guides: new Set(["communication", "members"]),
  answers: new Map([["A1", ID]]),
};

describe("parseAnswer", () => {
  it("strips the SOURCES line and keeps known sources", () => {
    const out = parseAnswer("Open Communication.\n\nSOURCES: guide:communication, answer:A1", known);
    expect(out.body).toBe("Open Communication.");
    expect(out.sources).toEqual(["guide:communication", `answer:${ID}`]);
    expect(out.grounded).toBe(true);
  });

  it("drops unknown slugs and answer codes", () => {
    const out = parseAnswer("Steps.\nSOURCES: guide:nope, answer:A9, guide:members", known);
    expect(out.sources).toEqual(["guide:members"]);
  });

  it("is null when the line is missing or cites nothing real", () => {
    expect(parseAnswer("Just an answer.", known).grounded).toBeNull();
    expect(parseAnswer("x\nSOURCES: guide:nope", known).grounded).toBeNull();
  });

  it("is false for SOURCES: none", () => {
    const out = parseAnswer("The guides don't cover this.\nSOURCES: none", known);
    expect(out.grounded).toBe(false);
    expect(out.sources).toEqual([]);
  });

  it("counts facts only for the advisor: a help answer was given no figures", () => {
    expect(parseAnswer("x\nSOURCES: facts", known)).toMatchObject({ sources: [], grounded: null });
    expect(parseAnswer("x\nSOURCES: facts, guide:members, FACTS", known, { facts: true })).toMatchObject({
      sources: ["facts", "guide:members"],
      grounded: true,
    });
  });
});

describe("conversationTitle", () => {
  it("is the first 80 characters of the question, on one line", () => {
    expect(conversationTitle("  How do I\n record   attendance?  ")).toBe("How do I record attendance?");
    const long = conversationTitle("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX);
    expect(long.endsWith(" ")).toBe(false);
  });
});

describe("exchangesOf", () => {
  const q = (id: string): ChatQuestion => ({ role: "user", id, content: id, redactions: 0, mode: "help", createdAt: "" });
  const a = (id: string): ChatAnswer => ({
    role: "assistant",
    id,
    content: id,
    kind: "answered",
    sources: [],
    helpful: null,
    mode: "advisor",
    figuresOk: true,
    savedAt: null,
    createdAt: "",
  });

  it("pairs each answer with the question before it", () => {
    const out = exchangesOf([q("q1"), a("a1"), q("q2"), a("a2")]);
    expect(out.map((e) => [e.question?.id ?? null, e.answer.id])).toEqual([
      ["q1", "a1"],
      ["q2", "a2"],
    ]);
  });

  it("gives an orphan answer no question rather than the wrong one", () => {
    expect(exchangesOf([a("a0"), q("q1"), a("a1")])[0].question).toBeNull();
  });
});

describe("answerKindFor", () => {
  it("maps outcomes to stored kinds", () => {
    expect(answerKindFor({ ok: true }, true)).toBe("answered");
    expect(answerKindFor({ ok: true }, null)).toBe("answered");
    expect(answerKindFor({ ok: true }, false)).toBe("not_in_guides");
    expect(answerKindFor({ ok: false, reason: "refused" }, null)).toBe("refused");
    expect(answerKindFor({ ok: false, reason: "truncated" }, null)).toBe("truncated");
    expect(answerKindFor({ ok: false, reason: "provider_error" }, null)).toBe("failed");
  });

  it("treats only the model failures as worth storing", () => {
    expect(isModelFailure("refused")).toBe(true);
    expect(isModelFailure("truncated")).toBe(true);
    expect(isModelFailure("provider_error")).toBe(true);
    for (const r of ["not_configured", "killed", "not_opted_in", "church_budget", "invalid_input", "made_up"]) {
      expect(isModelFailure(r)).toBe(false);
    }
  });

  it("names a dormant cause for every reason, with a generic fallback", () => {
    expect(dormantKeyFor("not_configured")).toBe("offEverywhere");
    expect(dormantKeyFor("not_opted_in")).toBe("offUntilConsent");
    expect(dormantKeyFor("church_budget")).toBe("offBudget");
    expect(dormantKeyFor("something_new")).toBe("offOther");
    expect(dormantKeyFor(undefined)).toBe("offOther");
  });
});

describe("reviewStatusFor", () => {
  it("keeps resolved and dismissed sticky", () => {
    expect(reviewStatusFor({ answerKind: "failed", grounded: null, helpful: false, current: "resolved" })).toBe("resolved");
    expect(reviewStatusFor({ answerKind: "answered", grounded: null, helpful: false, current: "dismissed" })).toBe("dismissed");
  });

  it("opens every kind that is not answered, except an off-topic reply", () => {
    for (const k of ["not_in_guides", "refused", "truncated", "failed"] as const) {
      expect(reviewStatusFor({ answerKind: k, grounded: true, helpful: null })).toBe("open");
    }
    // Off-topic traffic must not flood the queue.
    expect(reviewStatusFor({ answerKind: "out_of_scope", grounded: null, helpful: null })).toBe("none");
  });

  it("opens an ungrounded answer and an unhelpful one", () => {
    expect(reviewStatusFor({ answerKind: "answered", grounded: null, helpful: null })).toBe("open");
    expect(reviewStatusFor({ answerKind: "answered", grounded: true, helpful: false })).toBe("open");
  });

  it("leaves a grounded answer alone", () => {
    expect(reviewStatusFor({ answerKind: "answered", grounded: true, helpful: null })).toBe("none");
    expect(reviewStatusFor({ answerKind: "answered", grounded: true, helpful: true })).toBe("none");
  });

  it("recovers grounded from what is stored", () => {
    expect(groundedFromStored("answered", ["guide:members"])).toBe(true);
    expect(groundedFromStored("answered", [])).toBeNull();
    expect(groundedFromStored("not_in_guides", [])).toBe(false);
  });
});

describe("historyForModel", () => {
  const q = (content: string) => ({ role: "user", content, answerKind: null });
  const a = (content: string, answerKind: string) => ({ role: "assistant", content, answerKind });

  it("drops failed and truncated pairs", () => {
    const out = historyForModel([q("1"), a("x", "failed"), q("2"), a("y", "answered"), q("3"), a("z", "truncated")]);
    expect(out.map((m) => m.content)).toEqual(["2", "y"]);
  });

  it("never starts with an assistant turn", () => {
    const out = historyForModel([a("orphan", "answered"), q("1"), a("x", "answered")]);
    expect(out[0].role).toBe("user");
  });

  it("keeps at most HISTORY_TURNS rows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [q(`q${i}`), a(`a${i}`, "answered")]).flat();
    const out = historyForModel(rows);
    expect(out).toHaveLength(HISTORY_TURNS);
    expect(out[0]).toEqual({ role: "user", content: "q7" });
  });

  /*
   * A church withdrew consent, or a role lost giving: the next question is
   * help, and the advisor's earlier answer (attendance, follow-up, the
   * giving trend) must not ride along in its history.
   */
  it("leaves advisor exchanges out unless asked to include them, question and answer together", () => {
    const advisorAnswer = { role: "assistant", content: "Attendance averaged 140.", answerKind: "answered", mode: "advisor" };
    const rows = [
      { ...q("How is attendance?"), mode: "advisor" },
      advisorAnswer,
      { ...q("How do I record it?"), mode: "help" },
      { ...a("Open Attendance.", "answered"), mode: "help" },
    ];
    expect(historyForModel(rows).map((m) => m.content)).toEqual(["How do I record it?", "Open Attendance."]);
    expect(historyForModel(rows, { includeAdvisor: false }).map((m) => m.content)).not.toContain(advisorAnswer.content);
    expect(historyForModel(rows, { includeAdvisor: true }).map((m) => m.content)).toEqual([
      "How is attendance?",
      "Attendance averaged 140.",
      "How do I record it?",
      "Open Attendance.",
    ]);
  });
});

describe("safeAssistantHref", () => {
  it.each(["//evil.com", "javascript:alert(1)", "https://x", "/\\evil", "help/x", "/help\n/x"])(
    "refuses %s",
    (href) => expect(safeAssistantHref(href)).toBeNull(),
  );
  it("accepts a same-site path", () => {
    expect(safeAssistantHref("/help/sms")).toBe("/help/sms");
    expect(safeAssistantHref("/help/communication#send")).toBe("/help/communication#send");
  });
});

describe("prompts", () => {
  it("carries the SOURCES contract and the records line", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("SOURCES: none");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("cannot see or change church records");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("/help/support");
  });

  it("builds the user turn with no church parameter at all", () => {
    type Input = Parameters<typeof buildAssistantUserTurn>[0];
    expectTypeOf<keyof Input>().toEqualTypeOf<"locale" | "guideMap" | "extracts" | "question">();
    const turn = buildAssistantUserTurn({ locale: "fr", guideMap: "guide:x — X", extracts: "E", question: "Q?" });
    expect(turn).toContain("French");
    expect(turn.endsWith("Q?")).toBe(true);
  });

  it("round-trips a canned draft", () => {
    const prompt = buildCannedDraftPrompt({ question: "q", answerGiven: "a", extracts: "e" });
    expect(prompt).toContain("QUESTION ASKED:");
    const parsed = parseCannedDraft("QUESTION: How do I add a group?\nANSWER:\n1. Open Groups.\n2. Press Add.");
    expect(parsed).toEqual({ question: "How do I add a group?", answer: "1. Open Groups.\n2. Press Add." });
    expect(parseCannedDraft("no format here")).toBeNull();
  });
});

/*
 * runAi refuses an unregistered prompt id as invalid_input, which the panel
 * would have shown as "turned off" for every church, for ever. This pins the
 * registry to the texts this module parses replies against.
 */
describe("the prompt registry", () => {
  it("registers both assistant prompts with exactly these texts", () => {
    expect(isPromptId(ASSISTANT_PROMPT_ID)).toBe(true);
    expect(isPromptId(CANNED_DRAFT_PROMPT_ID)).toBe(true);
    expect(PROMPTS[ASSISTANT_PROMPT_ID]).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(PROMPTS[CANNED_DRAFT_PROMPT_ID]).toBe(CANNED_DRAFT_SYSTEM_PROMPT);
  });

  it("never lets a canned-answer draft be charged to a church", () => {
    expect(PROMPT_SCOPE[CANNED_DRAFT_PROMPT_ID]).toBe("platform");
    // A help question may come from a church or from the platform.
    expect(PROMPT_SCOPE[ASSISTANT_PROMPT_ID]).toBeUndefined();
  });
});
