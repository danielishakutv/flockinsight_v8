import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { RecordForm } from "@/components/attendance/record-form";
import { DeleteSessionButton } from "@/components/attendance/delete-session-button";

export const metadata = { title: "Edit Attendance" };

export default async function EditAttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { church } = await requireChurch();
  await requireCan("attendance.manage");

  const [row] = await db
    .select()
    .from(attendanceSession)
    .where(
      and(
        eq(attendanceSession.id, id),
        eq(attendanceSession.churchId, church.id),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const services = await db
    .select({ id: service.id, name: service.name })
    .from(service)
    .where(and(eq(service.churchId, church.id), eq(service.isActive, true)))
    .orderBy(asc(service.sortOrder), asc(service.name));

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="Edit attendance"
        description="Update the headcount or remove this record."
        action={<DeleteSessionButton id={row.id} />}
      />
      <RecordForm
        services={services}
        initial={{
          id: row.id,
          serviceId: row.serviceId,
          title: row.title ?? undefined,
          date: row.date,
          maleCount: row.maleCount,
          femaleCount: row.femaleCount,
          teenMaleCount: row.teenMaleCount,
          teenFemaleCount: row.teenFemaleCount,
          childMaleCount: row.childMaleCount,
          childFemaleCount: row.childFemaleCount,
          childrenCount: row.childrenCount,
          firstTimerMaleCount: row.firstTimerMaleCount,
          firstTimerFemaleCount: row.firstTimerFemaleCount,
          firstTimerCount: row.firstTimerCount,
          newConvertMaleCount: row.newConvertMaleCount,
          newConvertFemaleCount: row.newConvertFemaleCount,
          newConvertCount: row.newConvertCount,
          notes: row.notes ?? undefined,
        }}
      />
    </PageContainer>
  );
}
