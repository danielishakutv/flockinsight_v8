import { count, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, giving, group, staff, user } from "@/db/schema";
import { getActiveChurchCount, getChurchHealth } from "@/lib/platform-health";
import { getChurchPnl } from "@/lib/platform-stats";
import { isChurchVerified } from "@/lib/verification-shared";
import { OnboardChurch } from "@/components/superadmin/onboard-church";
import { requirePlatform } from "@/lib/platform-access";
import {
  ChurchesTable,
  type ChurchRow,
} from "@/components/superadmin/churches-table";

export const metadata = { title: "Churches · Admin" };
export const dynamic = "force-dynamic";

export default async function SuperadminChurchesPage() {
  await requirePlatform("platform.churches.view");
  const [health, active, pnl, extras, groupCounts, givingAgg, owners] = await Promise.all([
    // Real activity + health, from every module rather than attendance/giving.
    getChurchHealth(),
    // Used in the last 7 days — the Command centre's number, not a badge count.
    getActiveChurchCount(7),
    getChurchPnl(),
    db
      .select({
        id: church.id,
        currency: church.currency,
        featured: church.featured,
        contactEmail: church.contactEmail,
        contactPhone: church.contactPhone,
        emailVerifiedAt: church.emailVerifiedAt,
        phoneVerifiedAt: church.phoneVerifiedAt,
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

  // Real seats only: the temp seat acting-as creates is an operator, not
  // somebody on the church's team.
  const staffCounts = await db
    .select({ orgId: staff.organizationId, c: count() })
    .from(staff)
    .where(eq(staff.temp, false))
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
      verified: extra ? isChurchVerified(extra) : false,
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

  // The demo church is listed so it can be managed, but counted nowhere: it
  // is one shared login, rebuilt every two hours, and always "active".
  const demoIds = new Set(health.filter((c) => c.isDemo).map((c) => c.churchId));
  const counted = rows.filter((r) => !demoIds.has(r.id));
  const attention = counted.filter(
    (r) => r.health === "at_risk" || r.health === "never_activated",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Churches
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {counted.length} church{counted.length === 1 ? "" : "es"} · {active} active
          this week
          {attention > 0 ? ` · ${attention} need attention` : ""}.
        </p>
        </div>
        <OnboardChurch />
      </div>
      <ChurchesTable churches={rows} />
    </div>
  );
}
