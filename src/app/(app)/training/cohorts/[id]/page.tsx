import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import {
  enrollableMembers,
  getCohort,
  listEnrollments,
  listInstructors,
} from "@/lib/training";
import { COHORT_STATUSES } from "@/lib/training-shared";
import {
  CohortRoster,
  type RosterRow,
} from "@/components/training/cohort-roster";
import { PageContainer } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Class" };

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const STATUS_CLASS: Record<string, string> = {
  upcoming: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  running: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
};

function fmt(d: string | null) {
  if (!d) return null;
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function CohortDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("training.view");
  const canManage = await can("training.manage");

  const cohort = await getCohort(church.id, id);
  if (!cohort) notFound();

  const [enrollments, instructors, enrollable, allMembers] = await Promise.all([
    listEnrollments(cohort.id),
    listInstructors(cohort.id),
    enrollableMembers(church.id, cohort.id),
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        phone: member.phone,
      })
      .from(member)
      .where(eq(member.churchId, church.id))
      .orderBy(asc(member.firstName), asc(member.lastName)),
  ]);

  const roster: RosterRow[] = enrollments.map((e) => ({
    id: e.id,
    memberId: e.memberId,
    firstName: e.firstName,
    lastName: e.lastName,
    phone: e.phone,
    status: e.status,
    score: e.score,
    grade: e.grade,
    certificateNo: e.certificateNo,
    completedAt: e.completedAt,
    notes: e.notes,
  }));

  return (
    <PageContainer>
      <Link
        href={`/training/courses/${cohort.courseId}`}
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> {cohort.course.name}
      </Link>

      <Card className="mb-6">
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {cohort.name}
            </h1>
            <span
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-bold",
                STATUS_CLASS[cohort.status],
              )}
            >
              {COHORT_STATUSES.find((s) => s.value === cohort.status)?.label}
            </span>
          </div>

          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {fmt(cohort.startDate) && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {fmt(cohort.startDate)}
                {fmt(cohort.endDate) && ` – ${fmt(cohort.endDate)}`}
              </span>
            )}
            {cohort.meetingDay != null && (
              <span>
                {DAYS[cohort.meetingDay]}
                {cohort.meetingTime && ` at ${cohort.meetingTime}`}
              </span>
            )}
            {cohort.venue && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {cohort.venue}
              </span>
            )}
            {cohort.capacity != null && (
              <span>
                {roster.length} of {cohort.capacity} places taken
              </span>
            )}
          </div>

          {cohort.notes && (
            <p className="text-muted-foreground mt-3 text-sm">{cohort.notes}</p>
          )}
        </CardContent>
      </Card>

      <CohortRoster
        cohortId={cohort.id}
        passMark={cohort.course.passMark}
        issuesCertificate={cohort.course.issuesCertificate}
        roster={roster}
        instructors={instructors}
        enrollable={enrollable}
        allMembers={allMembers}
        canManage={canManage}
      />
    </PageContainer>
  );
}
