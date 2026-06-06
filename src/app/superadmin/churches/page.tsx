import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, member, staff } from "@/db/schema";
import {
  ChurchesTable,
  type ChurchRow,
} from "@/components/superadmin/churches-table";

export const metadata = { title: "Churches · Admin" };

export default async function SuperadminChurchesPage() {
  const [churches, staffCounts, memberCounts] = await Promise.all([
    db
      .select({
        id: church.id,
        name: church.name,
        slug: church.slug,
        status: church.status,
        createdAt: church.createdAt,
      })
      .from(church)
      .orderBy(desc(church.createdAt)),
    db
      .select({ orgId: staff.organizationId, c: count() })
      .from(staff)
      .groupBy(staff.organizationId),
    db
      .select({ churchId: member.churchId, c: count() })
      .from(member)
      .groupBy(member.churchId),
  ]);

  const staffMap = new Map(staffCounts.map((s) => [s.orgId, s.c]));
  const memberMap = new Map(memberCounts.map((m) => [m.churchId, m.c]));

  const rows: ChurchRow[] = churches.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    staffCount: staffMap.get(c.id) ?? 0,
    memberCount: memberMap.get(c.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Churches
        </h1>
        <p className="text-muted-foreground mt-1">
          {rows.length} church{rows.length === 1 ? "" : "es"} on the platform.
        </p>
      </div>
      <ChurchesTable churches={rows} />
    </div>
  );
}
