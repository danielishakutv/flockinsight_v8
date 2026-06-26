import { count, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceSession,
  church,
  giving,
  group,
  member,
  staff,
  user,
} from "@/db/schema";
import {
  ChurchesTable,
  type ChurchRow,
} from "@/components/superadmin/churches-table";

export const metadata = { title: "Churches · Admin" };

export default async function SuperadminChurchesPage() {
  const [
    churches,
    staffCounts,
    memberCounts,
    groupCounts,
    attAgg,
    givingAgg,
    owners,
  ] = await Promise.all([
    db
      .select({
        id: church.id,
        name: church.name,
        slug: church.slug,
        status: church.status,
        currency: church.currency,
        createdAt: church.createdAt,
        featured: church.featured,
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
    db
      .select({ churchId: group.churchId, c: count() })
      .from(group)
      .groupBy(group.churchId),
    db
      .select({
        churchId: attendanceSession.churchId,
        c: count(),
        last: max(attendanceSession.date),
        head: sql<number>`coalesce(sum(${attendanceSession.totalCount}), 0)`,
      })
      .from(attendanceSession)
      .groupBy(attendanceSession.churchId),
    db
      .select({
        churchId: giving.churchId,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
        last: max(giving.date),
      })
      .from(giving)
      .groupBy(giving.churchId),
    db
      .select({ orgId: staff.organizationId, email: user.email })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .where(eq(staff.role, "owner")),
  ]);

  const staffMap = new Map(staffCounts.map((s) => [s.orgId, Number(s.c)]));
  const memberMap = new Map(memberCounts.map((m) => [m.churchId, Number(m.c)]));
  const groupMap = new Map(groupCounts.map((g) => [g.churchId, Number(g.c)]));
  const attMap = new Map(attAgg.map((a) => [a.churchId, a]));
  const givingMap = new Map(givingAgg.map((g) => [g.churchId, g]));
  const ownerMap = new Map(owners.map((o) => [o.orgId, o.email]));

  const rows: ChurchRow[] = churches.map((c) => {
    const att = attMap.get(c.id);
    const giv = givingMap.get(c.id);
    // Most recent of: last attendance, last gift, or church creation.
    const dates = [att?.last ?? null, giv?.last ?? null].filter(
      Boolean,
    ) as string[];
    const lastActivity = dates.sort().at(-1) ?? null;
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      currency: c.currency,
      createdAt: c.createdAt.toISOString(),
      featured: c.featured,
      ownerEmail: ownerMap.get(c.id) ?? null,
      staffCount: staffMap.get(c.id) ?? 0,
      memberCount: memberMap.get(c.id) ?? 0,
      groupCount: groupMap.get(c.id) ?? 0,
      sessionCount: att ? Number(att.c) : 0,
      lastActivity,
      totalGiving: giv ? Number(giv.total) : 0,
    };
  });

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
