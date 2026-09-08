import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
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
  await requireCan("training.view");
  const canManage = await can("training.manage");

  const [overview, courses, cohorts] = await Promise.all([
    trainingOverview(church.id),
    listCourses(church.id),
    listCohorts(church.id),
  ]);

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
      <PageHeader
        title="Training & Classes"
        description="Foundation, Baptism, Pre-Marital, leadership training — who is taking what, and who has finished."
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <Stat label="Courses" value={overview.courses} />
          <Stat label="Classes running" value={overview.activeCohorts} />
          <Stat label="Enrolments" value={overview.enrolled} />
          <Stat label="Completions" value={overview.completed} />
          <Stat label="Members certified" value={overview.certified} />
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
