import { requireChurch } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { CURRICULUM } from "@/lib/guide-quizzes";
import { courseSummary, highestRank, rankBadge } from "@/lib/certification-shared";
import { listCertificates, listProgress } from "@/lib/certification";
import { TrainingBadge } from "@/components/training/training-badge";

/**
 * The second line of the Help index's course card: the signed-in person's own
 * "{passed} of {total} modules passed", with their rank chip once they hold
 * one. A server component, so it can sit inside the card's <Link> on the Help
 * page without shipping any progress rows to the browser.
 */
export async function CourseProgressLine() {
  const [{ user }, t] = await Promise.all([requireChurch(), getT()]);
  const [progress, certs] = await Promise.all([listProgress(user.id), listCertificates(user.id)]);
  const summary = courseSummary(CURRICULUM, progress);
  const live = certs.filter((c) => !c.revokedAt);
  const top = highestRank(live.map((c) => c.rank));
  const topCert = top ? live.find((c) => c.rank === top) : undefined;

  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
      {t("course.modulesPassed", { passed: summary.passed, total: summary.total })}
      {top && topCert && (
        <TrainingBadge badge={rankBadge(top, topCert.issuedAt.toISOString().slice(0, 10))} />
      )}
    </span>
  );
}

/** The slugs this person has passed, for HelpBrowser's `passed` prop. */
export async function passedGuideSlugs(): Promise<string[]> {
  const { user } = await requireChurch();
  const progress = await listProgress(user.id);
  return progress.filter((p) => p.passedAt).map((p) => p.guideSlug);
}
