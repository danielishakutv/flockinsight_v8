/**
 * The FlockInsight course: the pure half.
 *
 * Safe for client and server alike, and therefore holds NO quiz data. The
 * questions and their answers live in the server-only `lib/help/*.quiz.ts`
 * files; this module only knows the shape of a quiz and how to grade one it
 * is handed, so importing it from a client component cannot ship an answer
 * key to a browser.
 *
 * Every rule that decides a rank is here, in one place, so the course page,
 * the quiz-time issuer and the nightly cron cannot disagree about what
 * "13 weeks of real use" means.
 */
import type { EarnedBadge } from "@/lib/training-shared";

/* ------------------------------------------------------------------ *
 * Ranks
 * ------------------------------------------------------------------ */

export type CertRank = "professional" | "master" | "expert";

export const MASTER_ACTIVE_WEEKS = 13;
export const EXPERT_ACTIVE_WEEKS = 52;
/*
 * Thirteen distinct Monday-to-Sunday weeks fit inside 79 days, so a week count
 * alone does not make "three months" true. The span floor does: first active
 * day to last, inclusive.
 */
export const MASTER_MIN_SPAN_DAYS = 91;
export const EXPERT_MIN_SPAN_DAYS = 365;

export type RankInfo = {
  key: CertRank;
  /** A product proper noun, kept in English in every language and on the PDF. */
  label: string;
  /** What fits on the chip beside a name. */
  short: string;
  minWeeks: number;
  minSpanDays: number;
  /** A TRAINING_BADGE_COLORS key, so the chip reuses the training badge. */
  color: "sky" | "violet" | "amber";
  /** A TRAINING_BADGE_ICONS key. */
  icon: "award" | "star" | "crown";
};

export const RANKS: RankInfo[] = [
  {
    key: "professional",
    label: "FlockInsight Professional",
    short: "FI Pro",
    minWeeks: 0,
    minSpanDays: 0,
    color: "sky",
    icon: "award",
  },
  {
    key: "master",
    label: "FlockInsight Master",
    short: "FI Master",
    minWeeks: MASTER_ACTIVE_WEEKS,
    minSpanDays: MASTER_MIN_SPAN_DAYS,
    color: "violet",
    icon: "star",
  },
  {
    key: "expert",
    label: "FlockInsight Expert",
    short: "FI Expert",
    minWeeks: EXPERT_ACTIVE_WEEKS,
    minSpanDays: EXPERT_MIN_SPAN_DAYS,
    color: "amber",
    icon: "crown",
  },
];

const RANK_ORDER: CertRank[] = ["professional", "master", "expert"];

export function isCertRank(value: unknown): value is CertRank {
  return typeof value === "string" && (RANK_ORDER as string[]).includes(value);
}

export function rankInfo(rank: CertRank): RankInfo {
  // RANKS covers every CertRank, so the find cannot miss.
  return RANKS.find((r) => r.key === rank) as RankInfo;
}

/* ------------------------------------------------------------------ *
 * Active days and weeks
 * ------------------------------------------------------------------ */

export type Standing = {
  /** Distinct Monday-to-Sunday UTC weeks with at least one active day. */
  weeks: number;
  firstDay: string | null;
  lastDay: string | null;
  /** First active day to last, inclusive. 0 when there are none. */
  spanDays: number;
};

export const EMPTY_STANDING: Standing = {
  weeks: 0,
  firstDay: null,
  lastDay: null,
  spanDays: 0,
};

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The Monday (UTC) of the week holding this "YYYY-MM-DD" day. */
export function weekStart(day: string): string {
  const ms = dayToMs(day);
  // getUTCDay: Sunday 0 .. Saturday 6. Monday-based offset: Sunday is 6 days in.
  const offset = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The one definition of how much somebody has used FlockInsight. The course
 * page, the quiz-time issuer and the cron all call this, so SQL and JS never
 * hold two versions of "a week".
 */
export function activeStanding(days: string[]): Standing {
  const valid = [...new Set(days.filter((d) => DAY_RE.test(d) && !Number.isNaN(dayToMs(d))))].sort();
  if (valid.length === 0) return EMPTY_STANDING;
  const weeks = new Set(valid.map(weekStart)).size;
  const firstDay = valid[0];
  const lastDay = valid[valid.length - 1];
  const spanDays = Math.round((dayToMs(lastDay) - dayToMs(firstDay)) / DAY_MS) + 1;
  return { weeks, firstDay, lastDay, spanDays };
}

/**
 * Which ranks this standing has earned. Master and Expert require HOLDING
 * Professional (or earning it in this same call), not a currently complete
 * curriculum: a guide added after somebody was certified does not take a
 * certificate away, and must not block the next one either.
 */
export function ranksEarned(input: {
  holdsProfessional: boolean;
  allModulesPassed: boolean;
  standing: Standing;
}): CertRank[] {
  const { holdsProfessional, allModulesPassed, standing } = input;
  if (!holdsProfessional && !allModulesPassed) return [];
  const out: CertRank[] = ["professional"];
  for (const r of RANKS) {
    if (r.key === "professional") continue;
    if (standing.weeks >= r.minWeeks && standing.spanDays >= r.minSpanDays) out.push(r.key);
  }
  return out;
}

export function highestRank(ranks: CertRank[]): CertRank | null {
  let best: CertRank | null = null;
  for (const r of ranks) {
    if (best === null || RANK_ORDER.indexOf(r) > RANK_ORDER.indexOf(best)) best = r;
  }
  return best;
}

/**
 * How far the next usage rank is, for the course page. Null once both Master
 * and Expert are held.
 */
export function nextRankGap(
  standing: Standing,
  held: CertRank[],
): { rank: CertRank; weeksToGo: number; spanDaysToGo: number } | null {
  for (const r of RANKS) {
    if (r.key === "professional" || held.includes(r.key)) continue;
    return {
      rank: r.key,
      weeksToGo: Math.max(0, r.minWeeks - standing.weeks),
      spanDaysToGo: Math.max(0, r.minSpanDays - standing.spanDays),
    };
  }
  return null;
}

/**
 * The rank as a training badge, so it sits beside a name with the same chip.
 * Level -1 so a church's own course still wins highestBadge: inside a church,
 * its own Foundation class says more about a person than our course does.
 */
export function rankBadge(rank: CertRank, issuedAt: string | null): EarnedBadge {
  const r = rankInfo(rank);
  return {
    courseId: `flockinsight:${rank}`,
    name: r.label,
    label: r.short,
    color: r.color,
    icon: r.icon,
    level: -1,
    completedAt: issuedAt,
  };
}

/* ------------------------------------------------------------------ *
 * Quizzes
 * ------------------------------------------------------------------ */

export type QuizQuestion = {
  q: string;
  options: string[];
  /** Index into `options` of the one correct answer. Never leaves the server. */
  answer: number;
  /** The guide section that teaches it (an index into `sections`), or its FAQ. */
  section: number | "faq";
  /** Shown after a pass, to settle the reasoning. Never leaves the server before one. */
  why?: string;
};

export type GuideQuiz = { slug: string; questions: QuizQuestion[]; passMark?: number };

/** What a browser is given: the questions and options, nothing that grades them. */
export type PublicQuiz = {
  slug: string;
  version: string;
  passMark: number;
  questions: { q: string; options: { index: number; text: string }[] }[];
};

export function passMarkFor(quiz: GuideQuiz): number {
  return quiz.passMark ?? Math.ceil(0.75 * quiz.questions.length);
}

/**
 * A hash of the questions as they stand. An answer sheet is a list of option
 * indexes, so it can only be graded against the quiz it was answered on; a
 * deploy that edits a question changes this, and a stale sheet is refused
 * rather than mis-graded. FNV-1a, 32-bit: collision resistance against an
 * attacker is not the point, noticing an edit is.
 *
 * The ANSWER is deliberately not hashed. The version is sent to every browser
 * beside the questions and options, so a hash that included the answers could
 * be inverted offline by trying every combination (a five-question quiz has
 * about a thousand) and the key would ship after all. An answer-only fix needs
 * no new version either: the sheet's indexes still point at the same options,
 * and grading it against the corrected key is the right result.
 */
export function quizVersion(quiz: GuideQuiz): string {
  const text = JSON.stringify(quiz.questions.map((q) => [q.q, q.options]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The quiz as a browser may see it. Built as a NEW object from `q` and the
 * option text only, so neither `answer` nor `why` can leak through a spread.
 * The shuffler is injected: the server passes a crypto one, tests pass the
 * identity.
 */
export function publicQuiz(
  quiz: GuideQuiz,
  shuffle: <T>(xs: T[]) => T[],
): PublicQuiz {
  return {
    slug: quiz.slug,
    version: quizVersion(quiz),
    passMark: passMarkFor(quiz),
    questions: quiz.questions.map((question) => ({
      q: question.q,
      options: shuffle(question.options.map((text, index) => ({ index, text }))),
    })),
  };
}

export type GradeResult =
  | {
      ok: true;
      correct: number;
      total: number;
      passMark: number;
      passed: boolean;
      /** Sections that taught the questions answered wrongly, deduplicated. */
      reread: (number | "faq")[];
    }
  | { ok: false };

/** Grade an answer sheet of authored option indexes. Anything malformed is refused. */
export function gradeQuiz(quiz: GuideQuiz, answers: unknown): GradeResult {
  if (!Array.isArray(answers) || answers.length !== quiz.questions.length) return { ok: false };
  let correct = 0;
  const reread: (number | "faq")[] = [];
  for (let i = 0; i < quiz.questions.length; i++) {
    const question = quiz.questions[i];
    const a: unknown = answers[i];
    if (typeof a !== "number" || !Number.isInteger(a) || a < 0 || a >= question.options.length) {
      return { ok: false };
    }
    if (a === question.answer) correct++;
    else if (!reread.includes(question.section)) reread.push(question.section);
  }
  const passMark = passMarkFor(quiz);
  return {
    ok: true,
    correct,
    total: quiz.questions.length,
    passMark,
    passed: correct >= passMark,
    reread,
  };
}

/** A uniform float in [0, 1) from the platform's CSPRNG (browser and Node alike). */
export function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

/** Fisher-Yates over a copy, with the random source injected. */
export function shuffleWith(random: () => number): <T>(xs: T[]) => T[] {
  return <T>(xs: T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
}

/* ------------------------------------------------------------------ *
 * Certificate codes
 * ------------------------------------------------------------------ */

/**
 * No vowels (no words spelled by accident) and none of 0 1 2 5 8, which read
 * as O I Z S B off a printed page. The meetings alphabet, uppercased.
 */
export const CERT_CODE_ALPHABET = "BCDFGHJKMNPQRTVWXY34679";

/*
 * 230 = 23 * 10. Bytes below it map onto the alphabet exactly ten times each;
 * a byte at or above it is thrown away rather than reduced, because
 * `byte % 23` over all 256 values would make the first letters more likely
 * than the rest. (Any multiple of 23 is uniform; this one keeps the rule a
 * round number that is easy to check in a test.)
 */
const REJECT_FROM = CERT_CODE_ALPHABET.length * 10;

function cryptoBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/** "FI-XXXX-XXXX", by rejection sampling. The byte source is injectable for tests. */
export function generateCertCode(randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  const chars: string[] = [];
  // Bounded so a broken byte source fails loudly instead of spinning for ever.
  for (let round = 0; chars.length < 8; round++) {
    if (round > 64) throw new Error("generateCertCode: the byte source kept returning rejected bytes");
    for (const b of randomBytes(16)) {
      if (b >= REJECT_FROM) continue;
      chars.push(CERT_CODE_ALPHABET[b % CERT_CODE_ALPHABET.length]);
      if (chars.length === 8) break;
    }
  }
  return `FI-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * Read a code the way a person types it: lowercase, spaces, missing dashes.
 * Returns the canonical form, or null when it cannot be one.
 */
export function normaliseCertCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]+/g, "");
  if (s.length === 10 && s.startsWith("FI")) s = s.slice(2);
  if (s.length !== 8) return null;
  for (const c of s) if (!CERT_CODE_ALPHABET.includes(c)) return null;
  return `FI-${s.slice(0, 4)}-${s.slice(4)}`;
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export type ModuleState = "unread" | "read" | "passed";

export function moduleState(row: { passedAt: Date | string | null } | null | undefined): ModuleState {
  if (!row) return "unread";
  return row.passedAt ? "passed" : "read";
}

/**
 * Where somebody stands in the course. `read` counts modules marked complete
 * whose quiz is still to pass; `nextSlug` is the first module not yet passed.
 */
export function courseSummary(
  curriculum: string[],
  rows: { guideSlug: string; passedAt: Date | string | null }[],
): { total: number; read: number; passed: number; nextSlug: string | null } {
  const bySlug = new Map(rows.map((r) => [r.guideSlug, r]));
  let read = 0;
  let passed = 0;
  let nextSlug: string | null = null;
  for (const slug of curriculum) {
    const state = moduleState(bySlug.get(slug));
    if (state === "passed") passed++;
    else {
      if (state === "read") read++;
      nextSlug ??= slug;
    }
  }
  return { total: curriculum.length, read, passed, nextSlug };
}
