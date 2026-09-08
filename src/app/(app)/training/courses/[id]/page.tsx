import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Award } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { getCourse, listCohorts } from "@/lib/training";
import {
  TRAINING_KINDS,
  badgeColor,
  badgeLabelFor,
} from "@/lib/training-shared";
import { BadgeIcon } from "@/components/training/training-badge";
import {
  CohortsPanel,
  type CohortRowView,
} from "@/components/training/cohorts-panel";
import { PageContainer } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Course" };

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("training.view");
  const canManage = await can("training.manage");

  const course = await getCourse(church.id, id);
  if (!course) notFound();

  const cohorts = await listCohorts(church.id, course.id);
  const rows: CohortRowView[] = cohorts.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate,
    venue: c.venue,
    meetingDay: c.meetingDay,
    meetingTime: c.meetingTime,
    capacity: c.capacity,
    notes: c.notes,
    enrolled: c.enrolled,
    completed: c.completed,
  }));

  const color = badgeColor(course.badgeColor);
  const kind = TRAINING_KINDS.find((k) => k.value === course.kind);

  return (
    <PageContainer>
      <Link
        href="/training"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> Training
      </Link>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-start gap-4">
          <span
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-2xl ring-1 ring-inset",
              color.className,
            )}
          >
            <BadgeIcon
              icon={course.badgeIcon === "none" ? "graduation" : course.badgeIcon}
              className="size-6"
              strokeWidth={2.3}
            />
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {course.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-bold">
                {kind?.label}
              </span>
              <span className="text-muted-foreground text-[11px] font-semibold">
                Level {course.level}
              </span>
              {course.showBadge && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold ring-1 ring-inset",
                    color.className,
                  )}
                >
                  {badgeLabelFor(course)}
                </span>
              )}
              {course.passMark != null && (
                <span className="text-muted-foreground text-[11px] font-semibold">
                  Pass mark {course.passMark}
                </span>
              )}
              {course.issuesCertificate && (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-semibold">
                  <Award className="size-3" /> Certificate
                </span>
              )}
              {!course.isActive && (
                <span className="text-muted-foreground text-[10px] font-bold uppercase">
                  Inactive
                </span>
              )}
            </div>
            {course.description && (
              <p className="text-muted-foreground mt-2 text-sm">
                {course.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <CohortsPanel
        courseId={course.id}
        courseName={course.name}
        cohorts={rows}
        canManage={canManage}
      />
    </PageContainer>
  );
}
