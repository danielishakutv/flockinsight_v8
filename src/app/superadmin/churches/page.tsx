import { count, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, giving, group, staff, user } from "@/db/schema";
import { getChurchHealth } from "@/lib/platform-health";
import { getChurchPnl } from "@/lib/platform-stats";
import {
  ChurchesTable,
  type ChurchRow,
} from "@/components/superadmin/churches-table";

export const metadata = { title: "Churches · Admin" };
export const dynamic = "force-dynamic";

export default async function SuperadminChurchesPage() {
  const [health, pnl, extras, groupCounts, givingAgg, owners] = await Promise.all([
    // Real activity + health, from every module rather than attendance/giving.
    getChurchHealth(),
    getChurchPnl(),
    db
      .select({
        id: church.id,
        currency: church.currency,
        featured: church.featured,
      })
      .from(church),
    db
      .select({ churchId: group.churchId, c: count() })
      .from(group)
      .groupBy(group.churchId),
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

  const staffCounts = await db
    .select({ orgId: staff.organizationId, c: count() })
    .from(staff)
    .groupBy(staff.organizationId);

  const extraMap = new Map(extras.map((e) => [e.id, e]));
  const pnlMap = new Map(pnl.map((p) => [p.churchId, p]));
  const staffMap = new Map(staffCounts.map((s) => [s.orgId, Number(s.c)]));
  const groupMap = new Map(groupCounts.map((g) => [g.churchId, Number(g.c)]));
  const givingMap = new Map(givingAgg.map((g) => [g.churchId, g]));
  const ownerMap = new Map(owners.map((o) => [o.orgId, o.email]));

  const rows: ChurchRow[] = health.map((c) => {
    const extra = extraMap.get(c.churchId);
    const money = pnlMap.get(c.churchId);
    const giv = givingMap.get(c.churchId);

    return {
      id: c.churchId,
      name: c.name,
      slug: c.slug,
      status: c.status as "active" | "suspended",
      currency: extra?.currency ?? "NGN",
      createdAt: c.createdAt.toISOString(),
      featured: extra?.featured ?? false,
      ownerEmail: ownerMap.get(c.churchId) ?? null,
      staffCount: staffMap.get(c.churchId) ?? 0,
      memberCount: c.memberCount,
      groupCount: groupMap.get(c.churchId) ?? 0,
      sessionCount: c.sessionCount,
      lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
      health: c.health,
      funnelCompleted: c.funnelCompleted,
      totalGiving: giv ? Number(giv.total) : 0,
      revenue: money?.revenue ?? 0,
      cost: (money?.smsCost ?? 0) + (money?.storageCost ?? 0),
    };
  });

  const active = rows.filter((r) => r.health === "healthy").length;
  const attention = rows.filter(
    (r) => r.health === "at_risk" || r.health === "never_activated",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Churches
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {rows.length} church{rows.length === 1 ? "" : "es"} · {active} active
          this week
          {attention > 0 ? ` · ${attention} need attention` : ""}.
        </p>
      </div>
      <ChurchesTable churches={rows} />
    </div>
  );
}
