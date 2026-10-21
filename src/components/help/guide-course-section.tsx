import { requireChurch } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { CURRICULUM, getQuiz } from "@/lib/guide-quizzes";
import { moduleState, publicQuiz } from "@/lib/certification-shared";
import { cryptoShuffle, listProgress } from "@/lib/certification";
import { GuideCourseCard } from "@/components/help/guide-course-card";

/**
 * The course card at the foot of a guide: the guide page IS the module.
 *
 * A server component on purpose. The option order is decided here, once per
 * request, with the CSPRNG: shuffling in a client component's render would
 * give the server and the browser different orders (a hydration mismatch, and
 * options visibly jumping). The client receives `{ index, text }` options and
 * sends back authored indexes; it never sees which one is right.
 */
export async function GuideCourseSection({ slug }: { slug: string }) {
  const quiz = getQuiz(slug);
  const position = CURRICULUM.indexOf(slug);
  // A guide outside the course has no card rather than a broken one.
  if (!quiz || position < 0) return null;

  const [{ user, church, impersonating }, t] = await Promise.all([requireChurch(), getT()]);
  const rows = await listProgress(user.id);
  const row = rows.find((r) => r.guideSlug === slug) ?? null;
  const state = moduleState(row);

  const passed = new Set(rows.filter((r) => r.passedAt).map((r) => r.guideSlug));
  // Passing this one would certify them, so this is the moment to check the
  // name the certificate will carry.
  const finishesCourse = state !== "passed" && CURRICULUM.every((s) => s === slug || passed.has(s));

  const readOnlyReason = impersonating
    ? t("course.actingAsReadOnly")
    : church.isDemo
      ? t("course.demoReadOnly")
      : null;

  return (
    <GuideCourseCard
      slug={slug}
      position={position + 1}
      total={CURRICULUM.length}
      state={state}
      quiz={state === "unread" ? null : publicQuiz(quiz, cryptoShuffle)}
      best={row?.bestScore ?? null}
      readOnlyReason={readOnlyReason}
      holderName={finishesCourse ? user.name || user.email : null}
    />
  );
}
