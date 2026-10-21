import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarCheck, CheckCircle2, Circle, CircleDot } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/formatting";
import { GUIDES, GUIDE_CATEGORIES } from "@/lib/help-guides";
import { CURRICULUM } from "@/lib/guide-quizzes";
import {
  courseSummary,
  moduleState,
  nextRankGap,
  rankInfo,
  type CertRank,
} from "@/lib/certification-shared";
import { listCertificates, listProgress, standingFor } from "@/lib/certification";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { RankLadder, type RankLadderItem } from "@/components/help/rank-ladder";
import { HELP_ICONS } from "@/components/help/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "The FlockInsight course" };
export const dynamic = "force-dynamic";

/**
 * The course at a glance: the three ranks, how much real use has been
 * counted, and every module with its state. Everything here is the signed-in
 * person's own, keyed on their user id, the way /profile is.
 */
export default async function CoursePage() {
  const [{ user, church, impersonating }, t] = await Promise.all([requireChurch(), getT()]);
  const [progress, certs, standings] = await Promise.all([
    listProgress(user.id),
    listCertificates(user.id),
    standingFor([user.id]),
  ]);
  const standing = standings.get(user.id) ?? { weeks: 0, firstDay: null, lastDay: null, spanDays: 0 };
  const summary = courseSummary(CURRICULUM, progress);
  const bySlug = new Map(progress.map((p) => [p.guideSlug, p]));
  const date = (d: Date) => formatDate(d, t.locale, "medium", church.timezone);

  const held: CertRank[] = certs.filter((c) => !c.revokedAt).map((c) => c.rank);
  const holdsProfessional = held.includes("professional");
  const gap = nextRankGap(standing, held);

  const requirement: Record<CertRank, string> = {
    professional: t("course.rankProfessionalNeeds"),
    master: t("course.rankMasterNeeds"),
    expert: t("course.rankExpertNeeds"),
  };

  const ladder: RankLadderItem[] = (["professional", "master", "expert"] as const).map((rank) => {
    const cert = certs.find((c) => c.rank === rank);
    if (cert?.revokedAt) {
      return {
        rank,
        state: "withdrawn",
        requirement: requirement[rank],
        dateLine: t("course.verifyWithdrawn", { date: date(cert.revokedAt) }),
        issuedOn: null,
        code: null,
      };
    }
    if (cert) {
      return {
        rank,
        state: "earned",
        requirement: requirement[rank],
        dateLine: t("course.earnedOn", { date: date(cert.issuedAt) }),
        issuedOn: cert.issuedAt.toISOString().slice(0, 10),
        code: cert.code,
      };
    }
    const started = rank === "professional" ? summary.passed + summary.read > 0 : holdsProfessional;
    return {
      rank,
      state: started ? "progress" : "locked",
      requirement: requirement[rank],
      dateLine: null,
      issuedOn: null,
      code: null,
    };
  });

  const readOnlyReason = impersonating
    ? t("course.actingAsReadOnly")
    : church.isDemo
      ? t("course.demoReadOnly")
      : null;
  const nothingYet = summary.passed === 0 && summary.read === 0;
  const firstSlug = CURRICULUM[0];

  return (
    <PageContainer className="max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/help">
          <ArrowLeft className="size-4" /> {t("help.title")}
        </Link>
      </Button>

      <PageHeader title={t("course.title")} description={t("course.subtitle")} />

      {readOnlyReason && (
        <p className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{readOnlyReason}</p>
      )}

      <section className="mb-8 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold tracking-tight">{t("course.yourRank")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("course.modulesPassed", { passed: summary.passed, total: summary.total })}
          </p>
        </div>
        <RankLadder
          items={ladder}
          labels={{ download: t("course.downloadCertificate"), verify: t("course.verifyLink") }}
        />
      </section>

      <section className="bg-card mb-8 space-y-2 rounded-2xl border p-5">
        <p className="flex items-center gap-2 font-semibold">
          <CalendarCheck className="text-primary size-4 shrink-0" />
          {t("course.activeWeeks", { count: standing.weeks })}
        </p>
        {gap && gap.weeksToGo > 0 && (
          <p className="text-sm">
            {t("course.weeksToGo", { count: gap.weeksToGo, rank: rankInfo(gap.rank).label })}
          </p>
        )}
        {gap && gap.spanDaysToGo > 0 && (
          <p className="text-sm">
            {t("course.spanToGo", {
              rank: rankInfo(gap.rank).label,
              days: rankInfo(gap.rank).minSpanDays,
              have: standing.spanDays,
            })}
          </p>
        )}
        <p className="text-muted-foreground text-xs leading-relaxed">{t("course.activeWeekRule")}</p>
      </section>

      {!holdsProfessional && !readOnlyReason && (
        <p className="text-muted-foreground mb-6 text-sm">
          {t("course.certificateName", { name: user.name || user.email })}{" "}
          <Link href="/profile" className="text-primary font-medium hover:underline">
            {t("profile.title")}
          </Link>
        </p>
      )}

      {nothingYet && firstSlug && (
        <div className="mb-8">
          <Button asChild size="lg">
            <Link href={`/help/${firstSlug}#course`}>
              {t("course.startHere")} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      )}

      <div className="space-y-6">
        {GUIDE_CATEGORIES.map((cat) => {
          const guides = GUIDES.filter((g) => g.category === cat.key && CURRICULUM.includes(g.slug));
          if (guides.length === 0) return null;
          return (
            <section key={cat.key}>
              <h2 className="text-muted-foreground mb-2 text-xs font-bold tracking-wide uppercase">{cat.title}</h2>
              <div className="space-y-2">
                {guides.map((g) => {
                  const Icon = HELP_ICONS[g.icon] ?? HELP_ICONS.default;
                  const row = bySlug.get(g.slug);
                  const state = moduleState(row);
                  return (
                    <Link
                      key={g.slug}
                      href={`/help/${g.slug}#course`}
                      className="hover:bg-accent/60 bg-card flex items-center gap-3 rounded-xl border p-3"
                    >
                      <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{g.title}</span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset",
                          state === "passed" &&
                            "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
                          state === "read" && "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
                          state === "unread" && "bg-muted text-muted-foreground ring-transparent",
                        )}
                      >
                        {state === "passed" ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : state === "read" ? (
                          <CircleDot className="size-3.5" />
                        ) : (
                          <Circle className="size-3.5" />
                        )}
                        {state === "passed"
                          ? `${t("course.modulePassed")}${row?.bestScore != null ? ` · ${row.bestScore}%` : ""}`
                          : state === "read"
                            ? t("course.moduleRead")
                            : t("course.moduleUnread")}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </PageContainer>
  );
}
