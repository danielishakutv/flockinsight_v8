import { describe, expect, it } from "vitest";
import {
  CERT_CODE_ALPHABET,
  EXPERT_ACTIVE_WEEKS,
  EXPERT_MIN_SPAN_DAYS,
  MASTER_ACTIVE_WEEKS,
  MASTER_MIN_SPAN_DAYS,
  RANKS,
  activeStanding,
  courseSummary,
  generateCertCode,
  gradeQuiz,
  highestRank,
  nextRankGap,
  normaliseCertCode,
  publicQuiz,
  rankBadge,
  ranksEarned,
  shuffleWith,
  weekStart,
  type GuideQuiz,
  type Standing,
} from "@/lib/certification-shared";
import { TRAINING_BADGE_COLORS, TRAINING_BADGE_ICONS, highestBadge } from "@/lib/training-shared";

const quiz: GuideQuiz = {
  slug: "demo",
  questions: [
    { q: "Q1", options: ["a", "b", "c"], answer: 0, section: 0, why: "Because one." },
    { q: "Q2", options: ["a", "b"], answer: 1, section: 1 },
    { q: "Q3", options: ["a", "b", "c", "d"], answer: 2, section: 1 },
    { q: "Q4", options: ["a", "b"], answer: 0, section: "faq" },
  ],
};

const identity = <T,>(xs: T[]): T[] => xs;

describe("gradeQuiz", () => {
  it("counts correct answers and passes at the threshold", () => {
    // 4 questions need ceil(0.75 * 4) = 3.
    const r = gradeQuiz(quiz, [0, 1, 2, 1]);
    expect(r).toEqual({ ok: true, correct: 3, total: 4, passMark: 3, passed: true, reread: ["faq"] });
  });

  it("fails one below the threshold", () => {
    const r = gradeQuiz(quiz, [0, 1, 0, 1]);
    expect(r.ok && r.passed).toBe(false);
    expect(r.ok && r.correct).toBe(2);
  });

  it("refuses a sheet of the wrong length, a non-integer, -1 and an out-of-range index", () => {
    expect(gradeQuiz(quiz, [0, 1, 2])).toEqual({ ok: false });
    expect(gradeQuiz(quiz, [0, 1, 2, 0, 0])).toEqual({ ok: false });
    expect(gradeQuiz(quiz, [0, 1, 1.5, 0])).toEqual({ ok: false });
    expect(gradeQuiz(quiz, [0, 1, -1, 0])).toEqual({ ok: false });
    expect(gradeQuiz(quiz, [0, 2, 2, 0])).toEqual({ ok: false }); // Q2 has two options
    expect(gradeQuiz(quiz, "0,1,2,0")).toEqual({ ok: false });
    expect(gradeQuiz(quiz, [0, "1", 2, 0])).toEqual({ ok: false });
  });

  it("lists only the sections of wrong answers, once each", () => {
    const r = gradeQuiz(quiz, [1, 0, 0, 0]);
    expect(r.ok && r.reread).toEqual([0, 1]);
  });
});

describe("publicQuiz", () => {
  it("carries no answer and no explanation", () => {
    const json = JSON.stringify(publicQuiz(quiz, identity));
    expect(json).not.toContain("answer");
    expect(json).not.toContain("why");
    expect(json).not.toContain("Because one.");
    expect(json).not.toContain("section");
  });

  it("keeps each option's authored index, in authored order with an identity shuffle", () => {
    const p = publicQuiz(quiz, identity);
    expect(p.questions[2].options).toEqual([
      { index: 0, text: "a" },
      { index: 1, text: "b" },
      { index: 2, text: "c" },
      { index: 3, text: "d" },
    ]);
    expect(p.passMark).toBe(3);
    expect(p.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps index and text together when shuffled", () => {
    const reverse = <T,>(xs: T[]): T[] => [...xs].reverse();
    const p = publicQuiz(quiz, reverse);
    for (const q of p.questions) for (const o of q.options) expect(o.text).toBe(["a", "b", "c", "d"][o.index]);
    expect(p.questions[0].options[0]).toEqual({ index: 2, text: "c" });
  });

  it("shuffleWith returns a permutation and leaves the input alone", () => {
    const xs = [1, 2, 3, 4, 5];
    const out = shuffleWith(() => 0)(xs);
    expect([...out].sort()).toEqual(xs);
    expect(xs).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("weeks and standing", () => {
  it("starts a week on Monday", () => {
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
  });

  it("counts Sunday 18 and Monday 19 October 2026 as two weeks", () => {
    expect(activeStanding(["2026-10-18", "2026-10-19"]).weeks).toBe(2);
  });

  it("counts Monday to Sunday of one week as one week", () => {
    expect(activeStanding(["2026-10-19", "2026-10-21", "2026-10-25"]).weeks).toBe(1);
  });

  it("counts a duplicate day once", () => {
    const s = activeStanding(["2026-10-19", "2026-10-19"]);
    expect(s.weeks).toBe(1);
    expect(s.spanDays).toBe(1);
  });

  it("measures the span inclusively, from the first day to the last", () => {
    const s = activeStanding(["2026-10-25", "2026-10-19"]);
    expect(s).toEqual({ weeks: 1, firstDay: "2026-10-19", lastDay: "2026-10-25", spanDays: 7 });
  });

  it("is empty for no days", () => {
    expect(activeStanding([])).toEqual({ weeks: 0, firstDay: null, lastDay: null, spanDays: 0 });
  });
});

/** One active day in each of `weeks` consecutive weeks, from a Monday. */
function weekly(weeks: number, start = "2026-01-05"): string[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: weeks }, (_, i) =>
    new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10),
  );
}

function standing(weeks: number, spanDays: number): Standing {
  return { weeks, spanDays, firstDay: "2026-01-01", lastDay: "2026-12-31" };
}

describe("ranksEarned", () => {
  it("gives nothing without the course, however much use", () => {
    expect(ranksEarned({ holdsProfessional: false, allModulesPassed: false, standing: standing(100, 900) })).toEqual([]);
  });

  it("gives Professional for the course alone", () => {
    expect(ranksEarned({ holdsProfessional: false, allModulesPassed: true, standing: standing(0, 0) })).toEqual([
      "professional",
    ]);
  });

  it("holds Master back when 13 weeks fit inside 79 days", () => {
    // Sunday of week one to Monday of week thirteen.
    const days = ["2026-01-11", ...weekly(11, "2026-01-12"), "2026-03-30"];
    const s = activeStanding(days);
    expect(s.weeks).toBe(13);
    expect(s.spanDays).toBe(79);
    expect(ranksEarned({ holdsProfessional: false, allModulesPassed: true, standing: s })).toEqual(["professional"]);
  });

  it("adds Master at 13 weeks over 91 days", () => {
    const days = [...weekly(13), "2026-04-05"]; // 5 Jan to 5 Apr inclusive is 91 days
    const s = activeStanding(days);
    expect(s.spanDays).toBe(91);
    expect(s.weeks).toBe(13);
    expect(ranksEarned({ holdsProfessional: false, allModulesPassed: true, standing: s })).toEqual([
      "professional",
      "master",
    ]);
  });

  it("needs 365 days, not 364, for Expert", () => {
    expect(ranksEarned({ holdsProfessional: true, allModulesPassed: false, standing: standing(52, 364) })).toEqual([
      "professional",
      "master",
    ]);
    expect(ranksEarned({ holdsProfessional: true, allModulesPassed: false, standing: standing(52, 365) })).toEqual([
      "professional",
      "master",
      "expert",
    ]);
  });

  it("lets a certified Professional reach Master after the course has grown", () => {
    expect(ranksEarned({ holdsProfessional: true, allModulesPassed: false, standing: standing(13, 91) })).toEqual([
      "professional",
      "master",
    ]);
  });

  it("picks the highest rank", () => {
    expect(highestRank([])).toBeNull();
    expect(highestRank(["master", "professional"])).toBe("master");
    expect(highestRank(["professional", "expert", "master"])).toBe("expert");
  });

  it("says how far the next usage rank is", () => {
    expect(nextRankGap(standing(5, 40), ["professional"])).toEqual({
      rank: "master",
      weeksToGo: 8,
      spanDaysToGo: 51,
    });
    expect(nextRankGap(standing(20, 200), ["professional", "master"])).toEqual({
      rank: "expert",
      weeksToGo: 32,
      spanDaysToGo: 165,
    });
    expect(nextRankGap(standing(60, 400), ["professional", "master", "expert"])).toBeNull();
  });
});

describe("the ranks", () => {
  it("use thresholds of 13 and 52 weeks, over 91 and 365 days", () => {
    expect([MASTER_ACTIVE_WEEKS, EXPERT_ACTIVE_WEEKS]).toEqual([13, 52]);
    expect([MASTER_MIN_SPAN_DAYS, EXPERT_MIN_SPAN_DAYS]).toEqual([91, 365]);
  });

  it("use colours and icons the training badge can draw", () => {
    for (const r of RANKS) {
      expect(Object.keys(TRAINING_BADGE_COLORS)).toContain(r.color);
      expect(TRAINING_BADGE_ICONS as readonly string[]).toContain(r.icon);
    }
  });

  it("never outrank a church's own course on the chip", () => {
    const own = { courseId: "c1", name: "Foundation", label: "FND", color: "emerald", icon: "check", level: 0, completedAt: null };
    expect(highestBadge([rankBadge("expert", "2026-10-21"), own])?.courseId).toBe("c1");
    expect(rankBadge("master", null)).toMatchObject({ courseId: "flockinsight:master", label: "FI Master", level: -1 });
  });
});

describe("certificate codes", () => {
  const SHAPE = new RegExp(`^FI-[${CERT_CODE_ALPHABET}]{4}-[${CERT_CODE_ALPHABET}]{4}$`);

  it("match the printed shape", () => {
    expect(SHAPE.source).toBe("^FI-[BCDFGHJKMNPQRTVWXY34679]{4}-[BCDFGHJKMNPQRTVWXY34679]{4}$");
    for (let i = 0; i < 50; i++) expect(generateCertCode()).toMatch(SHAPE);
  });

  it("maps bytes onto the alphabet and skips any byte of 230 or more instead of reducing it", () => {
    // 230..255 would be 0..25 mod 23 and bias the first letters; they must be dropped.
    const bytes = [230, 255, 0, 1, 2, 3, 240, 4, 5, 6, 7, 0, 0, 0, 0, 0];
    const code = generateCertCode(() => Uint8Array.from(bytes));
    expect(code).toBe(
      `FI-${[0, 1, 2, 3].map((i) => CERT_CODE_ALPHABET[i]).join("")}-${[4, 5, 6, 7].map((i) => CERT_CODE_ALPHABET[i]).join("")}`,
    );
  });

  it("uses byte 229 as the last letter of the alphabet", () => {
    const code = generateCertCode(() => new Uint8Array(16).fill(229));
    expect(code).toBe("FI-9999-9999");
  });

  it("fails loudly on a byte source that only returns rejected bytes", () => {
    expect(() => generateCertCode(() => new Uint8Array(16).fill(250))).toThrow(/rejected bytes/);
  });

  it("reads a code typed loosely", () => {
    expect(normaliseCertCode("fi 7kq4m9xd")).toBe("FI-7KQ4-M9XD");
    expect(normaliseCertCode("FI-7KQ4-M9XD")).toBe("FI-7KQ4-M9XD");
    expect(normaliseCertCode("7kq4-m9xd")).toBe("FI-7KQ4-M9XD");
  });

  it("refuses the wrong length or a vowel", () => {
    expect(normaliseCertCode("FI-7KQ4-M9X")).toBeNull();
    expect(normaliseCertCode("FI-7KQ4-M9XDD")).toBeNull();
    expect(normaliseCertCode("FI-7KQ4-M9XA")).toBeNull();
    expect(normaliseCertCode("FI-7KQ4-M9X0")).toBeNull();
    expect(normaliseCertCode("")).toBeNull();
  });
});

describe("courseSummary", () => {
  it("counts passed and read modules and names the next one", () => {
    const s = courseSummary(["a", "b", "c", "d"], [
      { guideSlug: "a", passedAt: new Date() },
      { guideSlug: "b", passedAt: null },
      { guideSlug: "zzz", passedAt: new Date() }, // not in the course any more
    ]);
    expect(s).toEqual({ total: 4, read: 1, passed: 1, nextSlug: "b" });
  });

  it("has no next module once every one is passed", () => {
    expect(courseSummary(["a"], [{ guideSlug: "a", passedAt: "2026-10-21T00:00:00Z" }]).nextSlug).toBeNull();
  });
});
