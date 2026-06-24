import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { RecordForm } from "@/components/attendance/record-form";

export const metadata = { title: "Record Attendance" };

export default async function RecordPage() {
  const { church } = await requireChurch();
  await requireCan("attendance.manage");

  const services = await db
    .select({ id: service.id, name: service.name })
    .from(service)
    .where(and(eq(service.churchId, church.id), eq(service.isActive, true)))
    .orderBy(asc(service.sortOrder), asc(service.name));

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="Record Attendance"
        description="Pick a service, then tap to count. The total updates live."
      />
      <RecordForm services={services} />
    </PageContainer>
  );
}
