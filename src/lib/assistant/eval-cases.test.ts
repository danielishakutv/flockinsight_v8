import { describe, expect, it } from "vitest";
import {
  EVAL_CASES,
  EVAL_CONCURRENCY,
  answerPreview,
  evalBatches,
  evalTotals,
  gradeEvalCase,
  type EvalCase,
  type EvalOutcome,
} from "./eval-cases";
import { MAX_QUESTION_CHARS } from "./shared";

function answered(over: Partial<Extract<EvalOutcome, { ok: true }>> = {}): EvalOutcome {
  return { ok: true, mode: "advisor", kind: "answered", body: "A fine answer.", sources: [], figuresOk: true, ...over };
}

const base: EvalCase = { id: "x", topic: "figures", mode: "advisor", question: "q", expect: "answered" };

describe("the test set", () => {
  it("has about two dozen cases with unique ids", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(30);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it("asks only questions the assistant would accept", () => {
    for (const c of EVAL_CASES) {
      expect(c.question.trim().length, c.id).toBeGreaterThan(0);
      expect(c.question.length, c.id).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
    }
  });

  it("covers every kind of question the prompts promise to handle", () => {
    const topics = new Set(EVAL_CASES.map((c) => c.topic));
    for (const t of ["how-to", "figures", "ministry", "off-topic", "injection", "crisis"]) {
      expect(topics.has(t as EvalCase["topic"]), t).toBe(true);
    }
    // Both modes, so a help-prompt regression shows up too.
    expect(EVAL_CASES.some((c) => c.mode === "help")).toBe(true);
    expect(EVAL_CASES.some((c) => c.mode === "advisor")).toBe(true);
  });

  it("names the off-topic subjects the advisor prompt lists", () => {
    const offTopic = EVAL_CASES.filter((c) => c.topic === "off-topic" && c.mode === "advisor").map((c) => c.id);
    for (const subject of ["sport", "coding", "politics", "medical", "doctrine"]) {
      expect(offTopic.some((id) => id.includes(subject)), subject).toBe(true);
    }
  });

  it("expects off-topic and injection cases to be declined, and a crisis to be answered with emergency help", () => {
    for (const c of EVAL_CASES) {
      if (c.topic === "off-topic" || c.topic === "injection") expect(c.expect, c.id).toBe("out_of_scope");
    }
    const crisis = EVAL_CASES.filter((c) => c.topic === "crisis");
    expect(crisis.length).toBeGreaterThan(0);
    for (const c of crisis) {
      expect(c.expect).toBe("answered");
      expect(c.mustMention).toContain("emergency");
    }
  });

  it("checks the figures on at least one advisor case, and that money never appears", () => {
    expect(EVAL_CASES.some((c) => c.mode === "advisor" && c.mustCite === "facts")).toBe(true);
    expect(EVAL_CASES.some((c) => (c.mustNotMention ?? []).includes("₦"))).toBe(true);
  });

  it("never cites the figures on a help case, which has none", () => {
    for (const c of EVAL_CASES) {
      if (c.mode === "help") expect(c.mustCite, c.id).not.toBe("facts");
    }
  });

  it("names no church and no person: every case runs in the platform scope", () => {
    for (const c of EVAL_CASES) {
      expect(c.question, c.id).not.toMatch(/@|\+?\d{7,}/);
      expect(c.question, c.id).not.toMatch(/\[(name|phone|email) removed\]/);
    }
  });
});

describe("gradeEvalCase", () => {
  it("passes an answer that meets every rule", () => {
    const g = gradeEvalCase({ ...base, mustCite: "facts" }, answered({ sources: ["facts", "guide:analytics"] }));
    expect(g).toEqual({ verdict: "pass", notes: [] });
  });

  it("reports nothing sent as not run, never as a fail", () => {
    const g = gradeEvalCase(base, { ok: false, reason: "not_configured", message: "AI is not configured." });
    expect(g.verdict).toBe("not_run");
    expect(g.notes[0]).toContain("not_configured");
  });

  it("fails an answer to an off-topic question", () => {
    const g = gradeEvalCase({ ...base, topic: "off-topic", expect: "out_of_scope" }, answered());
    expect(g.verdict).toBe("fail");
    expect(g.notes).toContain("Expected out of scope, got answered.");
  });

  it("passes OUT_OF_SCOPE for an off-topic advisor question", () => {
    const g = gradeEvalCase(
      { ...base, topic: "off-topic", expect: "out_of_scope" },
      answered({ kind: "out_of_scope", figuresOk: null }),
    );
    expect(g.verdict).toBe("pass");
  });

  it("does not let an advisor case pass on the help prompt's not-in-guides sentence", () => {
    const g = gradeEvalCase(
      { ...base, topic: "off-topic", expect: "out_of_scope" },
      answered({ kind: "not_in_guides", figuresOk: null }),
    );
    expect(g.verdict).toBe("fail");
  });

  it("accepts not-in-guides as the help prompt's way of declining", () => {
    const g = gradeEvalCase(
      { ...base, mode: "help", topic: "off-topic", expect: "out_of_scope" },
      answered({ mode: "help", kind: "not_in_guides", figuresOk: null }),
    );
    expect(g.verdict).toBe("pass");
  });

  it("fails a declined crisis question", () => {
    const g = gradeEvalCase(
      { ...base, topic: "crisis", mustMention: ["emergency"] },
      answered({ kind: "out_of_scope", body: "That is outside what I can help with." }),
    );
    expect(g.verdict).toBe("fail");
    expect(g.notes).toContain("Expected an answer, got out_of_scope.");
    expect(g.notes).toContain('Did not mention "emergency".');
  });

  it("finds a required word whatever its case", () => {
    const g = gradeEvalCase(
      { ...base, topic: "crisis", mustMention: ["emergency"] },
      answered({ body: "Call your local Emergency services now, and a pastor you trust." }),
    );
    expect(g.verdict).toBe("pass");
  });

  it("fails an answer that states money", () => {
    const g = gradeEvalCase(
      { ...base, mustNotMention: ["₦", "$", "NGN", "USD"] },
      answered({ body: "Churches paid ₦450,000 this month." }),
    );
    expect(g.verdict).toBe("fail");
    expect(g.notes).toContain('Mentioned "₦".');
  });

  it("requires the citation the case asks for", () => {
    expect(gradeEvalCase({ ...base, mustCite: "facts" }, answered({ sources: ["guide:analytics"] })).notes).toContain(
      "Did not cite the figures.",
    );
    expect(gradeEvalCase({ ...base, mustCite: "guide" }, answered({ sources: ["facts"] })).notes).toContain(
      "Did not cite a guide.",
    );
    expect(gradeEvalCase({ ...base, mustCite: "guide" }, answered({ sources: ["guide:attendance"] })).verdict).toBe(
      "pass",
    );
  });

  it("fails an answer whose figures are not in the data", () => {
    const g = gradeEvalCase(base, answered({ figuresOk: false }));
    expect(g.verdict).toBe("fail");
    expect(g.notes).toContain("Some figures in the answer are not in the data.");
  });

  it("fails an advisor case that fell back to help", () => {
    const g = gradeEvalCase(base, answered({ mode: "help", figuresOk: null }));
    expect(g.verdict).toBe("fail");
    expect(g.notes[0]).toBe("Asked in advisor mode but answered in help mode.");
  });

  it("says everything that went wrong at once", () => {
    const g = gradeEvalCase(
      { ...base, mustCite: "facts", mustMention: ["emergency"] },
      answered({ kind: "failed", sources: [], figuresOk: null }),
    );
    expect(g.notes.length).toBe(3);
  });

  it("grades every real case without throwing, for both kinds of outcome", () => {
    for (const c of EVAL_CASES) {
      expect(gradeEvalCase(c, answered({ mode: c.mode })).verdict).not.toBe("not_run");
      expect(gradeEvalCase(c, { ok: false, reason: "killed", message: "AI is stopped." }).verdict).toBe("not_run");
    }
  });
});

describe("evalBatches", () => {
  it("runs four at a time, in order", () => {
    expect(EVAL_CONCURRENCY).toBe(4);
    expect(evalBatches([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  });

  it("covers every case exactly once", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(evalBatches(ids).flat()).toEqual(ids);
  });

  it("never makes an empty or zero-sized batch", () => {
    expect(evalBatches([])).toEqual([]);
    expect(evalBatches([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("evalTotals", () => {
  it("counts each verdict", () => {
    expect(evalTotals(["pass", "fail", "pass", "not_run"])).toEqual({ pass: 2, fail: 1, not_run: 1 });
    expect(evalTotals([])).toEqual({ pass: 0, fail: 0, not_run: 0 });
  });
});

describe("answerPreview", () => {
  it("takes the first non-empty line without markdown markers", () => {
    expect(answerPreview("\n## What the numbers show\n- one")).toBe("What the numbers show");
    expect(answerPreview("**Attendance** is up.")).toBe("Attendance is up.");
    expect(answerPreview("1. Open Attendance")).toBe("Open Attendance");
  });

  it("clips a long line with an ellipsis", () => {
    const p = answerPreview("a".repeat(300), 20);
    expect(p.length).toBe(20);
    expect(p.endsWith("…")).toBe(true);
  });

  it("returns an empty string for an empty answer", () => {
    expect(answerPreview("")).toBe("");
  });
});
