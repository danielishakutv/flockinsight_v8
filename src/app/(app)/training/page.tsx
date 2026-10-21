import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { Award, CalendarDays, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { ranksForUsers } from "@/lib/certification";
import { Button } from "@/components/ui/button";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listCohorts, listCourses, trainingOverview } from "@/lib/training";
import { COHORT_STATUSES } from "@/lib/training-shared";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import {
  CoursesList,
  type CourseListRow,
} from "@/components/training/courses-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";
import { PlanGate } from "@/components/app/plan-gate";

export const metadata = { title: "Training & Classes" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </p>
      <p className="text-2xl font-extrabold">{value.toLocaleString()}</p>
    </div>
  );
}

export default async function TrainingPage() {
  const { church } = await requireChurch();
  const t = await getT();
  await requireCan("training.view");
  const canManage = await can("training.manage");

  const [overview, courses, cohorts, team] = await Promise.all([
    trainingOverview(church.id),
    listCourses(church.id),
    listCohorts(church.id),
    // The team, not acting-as seats (temp), for the FlockInsight course card.
    db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.organizationId, church.id), eq(staff.temp, false))),
  ]);
  const teamIds = [...new Set(team.map((s) => s.userId))];
  const certified = (await ranksForUsers(teamIds)).size;

  const rows: CourseListRow[] = courses.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description,
    level: c.level,
    badgeLabel: c.badgeLabel,
    badgeColor: c.badgeColor,
    badgeIcon: c.badgeIcon,
    showBadge: c.showBadge,
    passMark: c.passMark,
    issuesCertificate: c.issuesCertificate,
    isActive: c.isActive,
    cohorts: c.cohorts,
    enrolled: c.enrolled,
    completed: c.completed,
  }));

  // The classes actually happening, which is what someone opening this page on
  // a Sunday is looking for.
  const live = cohorts
    .filter((c) => c.status === "running" || c.status === "upcoming")
    .slice(0, 6);

  return (
    <PageContainer>
      <PlanGate feature="training" />

      <PageHeader
        title={t("training.title")}
        description={t("training.subtitle")}
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <Stat label={t("training.courses")} value={overview.courses} />
          <Stat label={t("training.classesRunning")} value={overview.activeCohorts} />
          <Stat label={t("training.enrolments")} value={overview.enrolled} />
          <Stat label={t("training.completions")} value={overview.completed} />
          <Stat label={t("training.membersCertified")} value={overview.certified} />
        </CardContent>
      </Card>

      {/*
       * The FlockInsight course: platform-wide and per person, so it is not
       * one of this church's courses. Shown here because "who on the team
       * knows the system" is a training question.
       */}
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Award className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("course.title")}</p>
            <p className="text-muted-foreground text-sm">
              {t("course.teamCertified", { certified, team: teamIds.length })}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/help/course">{t("course.takeTheCourse")}</Link>
          </Button>
        </CardContent>
      </Card>

      {live.length > 0 && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4" /> Classes on now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {live.map((c) => (
              <Link
                key={c.id}
                href={`/training/cohorts/${c.id}`}
                className="hover:bg-accent/60 -mx-2 flex items-center gap-3 rounded-lg px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {c.name}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {c.courseName}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {COHORT_STATUSES.find((s) => s.value === c.status)?.label} ·{" "}
                    {c.enrolled} enrolled · {c.completed} completed
                  </p>
                </div>
                <ChevronRight className="text-muted-foreground/60 size-4 shrink-0" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <CoursesList courses={rows} canManage={canManage} />
    </PageContainer>
  );
}
