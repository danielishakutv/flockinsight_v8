import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { ServicesManager } from "@/components/settings/services-manager";

export const metadata = { title: "Services · Settings" };

export default async function ServicesSettingsPage() {
  const { church } = await requireChurch();
  const services = await db
    .select({
      id: service.id,
      name: service.name,
      dayOfWeek: service.dayOfWeek,
      startTime: service.startTime,
      isActive: service.isActive,
    })
    .from(service)
    .where(eq(service.churchId, church.id))
    .orderBy(asc(service.sortOrder), asc(service.name));

  return <ServicesManager services={services} />;
}
