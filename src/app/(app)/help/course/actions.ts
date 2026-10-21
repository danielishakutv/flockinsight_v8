"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireChurch } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { getGuide } from "@/lib/help-guides";
import { CURRICULUM, getQuiz, isCourseModule } from "@/lib/guide-quizzes";
import {
  gradeQuiz,
  publicQuiz,
  quizVersion,
  type CertRank,
  type PublicQuiz,
} from "@/lib/certification-shared";
import {
  cryptoShuffle,
  getGuideProgress,
  issueEarnedCertificates,
  listProgress,
  markComplete,
  recentAttemptCount,
  recordAttempt,
} from "@/lib/certification";

/*
 * The course records the signed-in person's OWN learning, so there is no
 * can() here, the same precedent as /profile: every staff role can read every
 * guide, and every statement below is keyed on user.id. What IS refused is
 * the two situations where "the signed-in person" is not one real person:
 * acting as a church, and the shared demo login.
 */

const RETAKE_WINDOW_MS = 15 * 60_000;
const RETAKES_PER_WINDOW = 5;

export type MarkResult = { ok: true; quiz: PublicQuiz } | { ok: false; error: string };

export type SubmitResult =
  | {
      ok: true;
      passed: boolean;
      correct: number;
      total: number;
      passMark: number;
      reread: { anchor: string; label: string }[];
      why: string[];
      newRanks: CertRank[];
      /** Set when the pass was saved but issuing the certificate failed. */
      certificateError: string | null;
    }
  | { ok: false; error: string };

type Session = Awaited<ReturnType<typeof requireChurch>>;
type CourseContext =
  | { t: Awaited<ReturnType<typeof getT>>; refused: string }
  | { t: Awaited<ReturnType<typeof getT>>; refused: null; user: Session["user"]; church: Session["church"] };

/** The common door: who is asking, and whether their progress can be kept. */
async function courseContext(): Promise<CourseContext> {
  const { user, church, impersonating } = await requireChurch();
  const t = await getT();
  if (impersonating) return { t, refused: t("course.actingAsReadOnly") };
  if (church.isDemo) return { t, refused: t("course.demoReadOnly") };
  return { t, user, church, refused: null };
}

function revalidate(slug: string) {
  revalidatePath(`/help/${slug}`);
  revalidatePath("/help/course");
  revalidatePath("/help");
}

export async function markGuideComplete(slugInput: string): Promise<MarkResult> {
  const ctx = await courseContext();
  if (ctx.refused !== null) return { ok: false, error: ctx.refused };
  const slug = z.string().max(80).safeParse(slugInput);
  const quiz = slug.success && isCourseModule(slug.data) ? getQuiz(slug.data) : undefined;
  if (!slug.success || !quiz) return { ok: false, error: ctx.t("course.notInCourse") };

  await markComplete(ctx.user.id, slug.data);
  revalidate(slug.data);
  return { ok: true, quiz: publicQuiz(quiz, cryptoShuffle) };
}

const submitSchema = z.object({
  slug: z.string().max(80),
  version: z.string().max(16),
  answers: z.array(z.number().int()).max(8),
});

export async function submitGuideQuiz(input: {
  slug: string;
  version: string;
  answers: number[];
}): Promise<SubmitResult> {
  const ctx = await courseContext();
  if (ctx.refused !== null) return { ok: false, error: ctx.refused };
  const { t, user, church } = ctx;

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("course.answersIncomplete") };
  const { slug, version, answers } = parsed.data;

  const quiz = isCourseModule(slug) ? getQuiz(slug) : undefined;
  const guide = getGuide(slug);
  if (!quiz || !guide) return { ok: false, error: t("course.notInCourse") };

  // Marking it complete is what opens the quiz; recordAttempt relies on the row.
  if (!(await getGuideProgress(user.id, slug))) return { ok: false, error: t("course.markFirst") };

  const now = Date.now();
  const recent = await recentAttemptCount(user.id, slug, new Date(now - RETAKE_WINDOW_MS));
  if (recent.count >= RETAKES_PER_WINDOW) {
    const freeAt = (recent.oldest?.getTime() ?? now) + RETAKE_WINDOW_MS;
    return {
      ok: false,
      error: t("course.quizRateLimited", {
        count: recent.count,
        minutes: Math.max(1, Math.ceil((freeAt - now) / 60_000)),
      }),
    };
  }

  // A sheet answered against an older version of the questions cannot be read
  // against the new ones; refuse it rather than mis-grade it.
  if (version !== quizVersion(quiz)) return { ok: false, error: t("course.quizChanged") };

  const grade = gradeQuiz(quiz, answers);
  if (!grade.ok) return { ok: false, error: t("course.answersIncomplete") };

  await recordAttempt({
    userId: user.id,
    slug,
    version,
    answers,
    correct: grade.correct,
    total: grade.total,
    passed: grade.passed,
    churchId: church.id,
  });

  let newRanks: CertRank[] = [];
  let certificateError: string | null = null;
  if (grade.passed) {
    const rows = await listProgress(user.id);
    const passed = new Set(rows.filter((r) => r.passedAt).map((r) => r.guideSlug));
    if (CURRICULUM.every((s) => passed.has(s))) {
      // The attempt is already saved. A failure here must not turn a pass
      // into an error page, so it is logged and named; the next passing
      // attempt at any module runs the issuer again.
      try {
        newRanks = await issueEarnedCertificates(user.id, { churchId: church.id });
      } catch (e) {
        console.error("[course] certificate issue failed for", user.id, e);
        certificateError = t("course.certificateFailed");
      }
    }
  }

  revalidate(slug);

  return {
    ok: true,
    passed: grade.passed,
    correct: grade.correct,
    total: grade.total,
    passMark: grade.passMark,
    // Sections only: never which option was right.
    reread: grade.reread.map((s) =>
      s === "faq"
        ? { anchor: "faq", label: t("course.rereadFaq") }
        : {
            anchor: `s${s}`,
            label: t("course.rereadSection", { section: guide.sections[s]?.title ?? `${s + 1}` }),
          },
    ),
    why: grade.passed ? quiz.questions.flatMap((q) => (q.why ? [q.why] : [])) : [],
    newRanks,
    certificateError,
  };
}
