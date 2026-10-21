import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/help-guides";
import { ALL_QUIZZES, CURRICULUM, QUIZZES, getQuiz } from "@/lib/guide-quizzes";
import { passMarkFor, quizVersion, type GuideQuiz } from "@/lib/certification-shared";

/*
 * The course's answer key, checked against the guides it grades. A guide that
 * ships without a quiz would make the Professional rank unreachable for
 * everybody, and a quiz pointing at a section that does not exist sends a
 * person to re-read nothing.
 */
describe("the guide quizzes", () => {
  it("gives every guide a quiz, and names no guide that does not exist", () => {
    const slugs = GUIDES.map((g) => g.slug);
    for (const s of slugs) expect(QUIZZES.has(s), `no quiz for guide "${s}"`).toBe(true);
    for (const q of ALL_QUIZZES) expect(slugs, `quiz for missing guide "${q.slug}"`).toContain(q.slug);
    // One quiz per guide: a duplicate would be silently dropped by the Map.
    expect(ALL_QUIZZES.length).toBe(QUIZZES.size);
  });

  it("uses the guides, in order, as the curriculum", () => {
    expect(CURRICULUM).toEqual(GUIDES.map((g) => g.slug));
  });

  for (const quiz of ALL_QUIZZES) {
    describe(quiz.slug, () => {
      const guide = GUIDES.find((g) => g.slug === quiz.slug);

      it("has 4 to 8 questions", () => {
        expect(quiz.questions.length).toBeGreaterThanOrEqual(4);
        expect(quiz.questions.length).toBeLessThanOrEqual(8);
      });

      it("gives each question 2 to 5 trimmed, non-empty, distinct options and an answer in range", () => {
        for (const q of quiz.questions) {
          expect(q.q.trim()).not.toBe("");
          expect(q.options.length).toBeGreaterThanOrEqual(2);
          expect(q.options.length).toBeLessThanOrEqual(5);
          for (const o of q.options) {
            expect(o).toBe(o.trim());
            expect(o).not.toBe("");
          }
          expect(new Set(q.options).size, `duplicate option in "${q.q}"`).toBe(q.options.length);
          expect(Number.isInteger(q.answer)).toBe(true);
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(q.answer).toBeLessThan(q.options.length);
        }
      });

      it("points every question at a real section, or at an FAQ the guide has", () => {
        expect(guide).toBeDefined();
        for (const q of quiz.questions) {
          if (q.section === "faq") {
            expect((guide?.faq ?? []).length, `"${q.q}" points at a missing FAQ`).toBeGreaterThan(0);
          } else {
            expect(Number.isInteger(q.section)).toBe(true);
            expect(q.section).toBeGreaterThanOrEqual(0);
            expect(q.section).toBeLessThan(guide?.sections.length ?? 0);
          }
        }
      });

      it("does not always hide the answer in the same position", () => {
        expect(new Set(quiz.questions.map((q) => q.answer)).size).toBeGreaterThanOrEqual(2);
      });

      /*
       * As first written, the right answer was the longest option in 133 of
       * 167 questions, and always picking the longest passed 23 of the 32
       * quizzes without reading a word. Here that strategy gets at most half
       * of a quiz right, which is always short of the pass mark.
       */
      it("cannot be passed by always picking the longest option", () => {
        const longestRight = quiz.questions.filter((q) => {
          const len = q.options[q.answer].length;
          return q.options.every((o, i) => i === q.answer || o.length < len);
        }).length;
        expect(longestRight).toBeLessThanOrEqual(Math.floor(quiz.questions.length / 2));
      });

      it("sets a pass mark between half and all of the questions", () => {
        const n = quiz.questions.length;
        expect(passMarkFor(quiz)).toBeGreaterThanOrEqual(Math.ceil(n / 2));
        expect(passMarkFor(quiz)).toBeLessThanOrEqual(n);
      });
    });
  }

  /*
   * A browser sees each option's AUTHORED index (it is the radio's value), so
   * if answers clustered on one position, reading the page source would beat
   * the quiz. They once never sat at index 3 and sat at 1 more than half the
   * time. Across the course, no position may hold more than 40% of them, and
   * every position of four-option questions is used.
   */
  it("spreads the answers across option positions", () => {
    const all = ALL_QUIZZES.flatMap((quiz) => quiz.questions);
    const counts = new Map<number, number>();
    for (const q of all) counts.set(q.answer, (counts.get(q.answer) ?? 0) + 1);
    for (const [position, n] of counts) {
      expect(n / all.length, `position ${position}`).toBeLessThanOrEqual(0.4);
    }
    const fours = all.filter((q) => q.options.length === 4);
    for (const position of [0, 1, 2, 3]) {
      expect(fours.some((q) => q.answer === position), `position ${position}`).toBe(true);
    }
  });

  it("finds a quiz by slug and nothing for an unknown one", () => {
    expect(getQuiz("getting-started")?.slug).toBe("getting-started");
    expect(getQuiz("not-a-guide")).toBeUndefined();
  });
});

describe("quizVersion", () => {
  const base: GuideQuiz = {
    slug: "x",
    questions: [
      { q: "One?", options: ["a", "b"], answer: 0, section: 0 },
      { q: "Two?", options: ["c", "d"], answer: 1, section: "faq" },
    ],
  };

  it("is stable for the same questions", () => {
    expect(quizVersion(base)).toBe(quizVersion(structuredClone(base)));
    expect(quizVersion(base)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when an option's text changes", () => {
    const edited = structuredClone(base);
    edited.questions[0].options[1] = "b2";
    expect(quizVersion(edited)).not.toBe(quizVersion(base));
  });

  it("changes when a question's wording changes", () => {
    const edited = structuredClone(base);
    edited.questions[1].q = "Two, reworded?";
    expect(quizVersion(edited)).not.toBe(quizVersion(base));
  });

  /*
   * The version ships to the browser beside the questions. If it hashed the
   * answers, trying every combination offline would recover the key, so it
   * must not depend on them at all, for any real quiz.
   */
  it("does not depend on the answers, so it cannot be inverted into the key", () => {
    for (const quiz of ALL_QUIZZES) {
      const blanked = structuredClone(quiz);
      for (const q of blanked.questions) q.answer = q.answer === 0 ? 1 : 0;
      expect(quizVersion(blanked), quiz.slug).toBe(quizVersion(quiz));
    }
  });

  it("ignores the explanation and the section, which do not change how a sheet is graded", () => {
    const edited = structuredClone(base);
    edited.questions[0].why = "Because.";
    edited.questions[0].section = 1;
    expect(quizVersion(edited)).toBe(quizVersion(base));
  });
});

/*
 * The answer-key boundary. Each file must start with `import "server-only"`
 * so Next refuses to build any client bundle that reaches it, even through an
 * intermediate module. Read as text, because vitest stubs the import.
 */
describe("the answer key stays on the server", () => {
  const helpDir = join(import.meta.dirname, "help");
  const files = [
    ...readdirSync(helpDir)
      .filter((f) => f.endsWith(".quiz.ts"))
      .map((f) => join(helpDir, f)),
    join(import.meta.dirname, "guide-quizzes.ts"),
  ];

  it("has one quiz file per guide file", () => {
    const guideFiles = readdirSync(helpDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".quiz.ts") && f !== "types.ts",
    );
    expect(files.length - 1).toBe(guideFiles.length);
  });

  for (const f of files) {
    it(`${f.split(/[\\/]/).pop()} begins with import "server-only"`, () => {
      const first = readFileSync(f, "utf8").replace(/^﻿/, "").split(/\r?\n/)[0].trim();
      expect(first).toMatch(/^import ["']server-only["'];?$/);
    });
  }
});
