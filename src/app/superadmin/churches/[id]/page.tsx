import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, count, desc, eq, max, sql } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  Coins,
  HandCoins,
  HardDrive,
  Layers,
  LogIn,
  Mail,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import { impersonateChurch } from "@/app/superadmin/actions";
import { db } from "@/db";
import {
  attendanceSession,
  church,
  giving,
  givingCategory,
  group,
  member,
  payment,
  role,
  service,
  staff,
  subscriber,
  user,
} from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { planName } from "@/lib/plans";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";
import { computeStanding } from "@/lib/trial";
import { denominationOptions } from "@/lib/denominations";
import { AdminBilling } from "@/components/superadmin/admin-billing";
import { ChurchDenomination } from "@/components/superadmin/church-denomination";
import { ChurchNetwork } from "@/components/superadmin/church-network";
import { ChurchDataTools } from "@/components/superadmin/church-data-tools";
import { ChurchTrialControls } from "@/components/superadmin/church-trial-controls";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Church · Admin" };

const MEMBER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  visitor: "Visitors",
  new_convert: "New converts",
};

export default async function SuperadminChurchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [[c], denominations, networkChurches] = await Promise.all([
    db.select().from(church).where(eq(church.id, id)).limit(1),
    denominationOptions(),
    // Everything we need to show and edit this church's place in a network.
    db
      .select({
        id: church.id,
        name: church.name,
        parentChurchId: church.parentChurchId,
        zone: church.zone,
      })
      .from(church)
      .orderBy(asc(church.name)),
  ]);
  if (!c) notFound();

  const [
    membersByStatus,
    [{ memberTotal }],
    [{ groupTotal }],
    attAgg,
    recentSessions,
    [givingAgg],
    givingByCategory,
    team,
    payments,
  ] = await Promise.all([
    db
      .select({ status: member.status, c: count() })
      .from(member)
      .where(eq(member.churchId, id))
      .groupBy(member.status),
    db
      .select({ memberTotal: count() })
      .from(member)
      .where(eq(member.churchId, id)),
    db
      .select({ groupTotal: count() })
      .from(group)
      .where(eq(group.churchId, id)),
    db
      .select({
        c: count(),
        avg: sql<number>`coalesce(round(avg(${attendanceSession.totalCount})), 0)`,
        last: max(attendanceSession.date),
      })
      .from(attendanceSession)
      .where(eq(attendanceSession.churchId, id)),
    db
      .select({
        id: attendanceSession.id,
        date: attendanceSession.date,
        title: attendanceSession.title,
        serviceName: service.name,
        total: attendanceSession.totalCount,
      })
      .from(attendanceSession)
      .leftJoin(service, eq(service.id, attendanceSession.serviceId))
      .where(eq(attendanceSession.churchId, id))
      .orderBy(desc(attendanceSession.date), desc(attendanceSession.createdAt))
      .limit(5),
    db
      .select({
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
        c: count(),
      })
      .from(giving)
      .where(eq(giving.churchId, id)),
    db
      .select({
        name: givingCategory.name,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .where(eq(giving.churchId, id))
      .groupBy(givingCategory.name)
      .orderBy(desc(sql`sum(${giving.amount})`)),
    db
      .select({
        name: user.name,
        email: user.email,
        baseRole: staff.role,
        customRole: role.name,
        createdAt: staff.createdAt,
      })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .leftJoin(role, eq(role.id, staff.roleId))
      .where(eq(staff.organizationId, id))
      .orderBy(asc(staff.createdAt)),
    db
      .select({
        id: payment.id,
        plan: payment.plan,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        gateway: payment.gateway,
        note: payment.note,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      })
      .from(payment)
      .where(eq(payment.churchId, id))
      .orderBy(desc(payment.createdAt))
      .limit(10),
  ]);

  const [storage, [{ subscriberTotal }]] = await Promise.all([
    getStorageInfo(id, c.storageExtraBytes),
    db
      .select({
        subscriberTotal: sql<number>`count(*) filter (where ${subscriber.status} = 'active')`,
      })
      .from(subscriber)
      .where(eq(subscriber.churchId, id)),
  ]);

  const standing = computeStanding(c);
  const standingLabel =
    standing.state === "waived"
      ? "Comped (payment waived)"
      : standing.state === "paid"
        ? "Active paid plan"
        : standing.state === "trialing"
          ? `On free trial (${standing.daysLeft ?? 0} days left)`
          : standing.state === "expired"
            ? "Trial expired — blocked until paid"
            : "No trial set (grandfathered)";

  const memberTotalN = Number(memberTotal);
  const sessionCount = attAgg[0] ? Number(attAgg[0].c) : 0;
  const avgAttendance = attAgg[0] ? Number(attAgg[0].avg) : 0;
  const lastAttendance = attAgg[0]?.last ?? null;
  const givingTotal = Number(givingAgg?.total ?? 0);
  const givingCount = Number(givingAgg?.c ?? 0);
  const ownerEmail = team.find((t) => t.baseRole === "owner")?.email ?? null;

  const statusCounts = new Map<string, number>(
    membersByStatus.map((m) => [m.status, Number(m.c)]),
  );

  async function enterChurch() {
    "use server";
    await impersonateChurch(id);
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/superadmin/churches">
          <ArrowLeft className="size-4" />
          All churches
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {c.name}
            </h1>
            <Badge
              variant={c.status === "suspended" ? "destructive" : "success"}
              className="capitalize"
            >
              {c.status}
            </Badge>
            <Badge variant="secondary">{planName(c.plan)}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            /{c.slug} · {c.currency} · {c.country}
            {c.state ? `, ${c.state}` : ""} · {c.timezone} · created{" "}
            {format(c.createdAt, "MMM d, yyyy")}
            {ownerEmail ? ` · owner ${ownerEmail}` : ""}
          </p>
        </div>
        <form action={enterChurch}>
          <Button type="submit">
            <LogIn className="size-4" />
            Log in as church
          </Button>
        </form>
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Members" value={memberTotalN} icon={Users} accent />
        <StatCard label="Team" value={team.length} icon={UserCog} />
        <StatCard label="Groups" value={Number(groupTotal)} icon={UsersRound} />
        <StatCard
          label="Services recorded"
          value={sessionCount}
          icon={ClipboardCheck}
        />
        <StatCard
          label="Avg attendance"
          value={avgAttendance}
          icon={CalendarDays}
        />
        <StatCard
          label="Total giving"
          value={formatMoney(givingTotal, c.currency)}
          sub={`${givingCount} record${givingCount === 1 ? "" : "s"}`}
          icon={HandCoins}
        />
        <StatCard
          label="Last service"
          value={
            lastAttendance ? format(parseISO(lastAttendance), "MMM d") : "—"
          }
          sub={lastAttendance ? format(parseISO(lastAttendance), "yyyy") : ""}
          icon={Layers}
        />
        <StatCard
          label="Storage used"
          value={formatBytes(storage.used)}
          sub={`of ${formatBytes(storage.limit)}`}
          icon={HardDrive}
        />
        <StatCard
          label="Subscribers"
          value={Number(subscriberTotal)}
          sub="Newsletter mailing list"
          icon={Mail}
        />
      </div>

      <ChurchNetwork
        churchId={c.id}
        parentId={c.parentChurchId}
        branches={networkChurches
          .filter((n) => n.parentChurchId === c.id)
          .map((n) => ({ id: n.id, name: n.name, zone: n.zone }))}
        candidates={networkChurches
          .filter((n) => n.id !== c.id && n.parentChurchId === null)
          .map((n) => ({ id: n.id, name: n.name }))}
      />

      <ChurchDenomination
        churchId={c.id}
        current={c.denominationId}
        typedLabel={c.denomination}
        options={denominations}
      />

      <AdminBilling
        churchId={c.id}
        plan={c.plan}
        discount={c.planDiscountPct}
        renewsAt={c.planRenewsAt ? c.planRenewsAt.toISOString() : null}
        payments={payments.map((p) => ({
          id: p.id,
          plan: p.plan,
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
          gateway: p.gateway,
          note: p.note,
          createdAt: (p.paidAt ?? p.createdAt).toISOString(),
        }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Members by status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="text-primary size-5" /> Members by status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {memberTotalN === 0 ? (
              <p className="text-muted-foreground text-sm">No members yet.</p>
            ) : (
              Object.keys(MEMBER_STATUS_LABEL).map((s) => {
                const n = statusCounts.get(s) ?? 0;
                const pct = memberTotalN
                  ? Math.round((n / memberTotalN) * 100)
                  : 0;
                return (
                  <div key={s} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{MEMBER_STATUS_LABEL[s]}</span>
                      <span className="font-bold tabular-nums">{n}</span>
                    </div>
                    <div className="bg-muted h-2 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Giving by category */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="text-primary size-5" /> Giving by category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {givingByCategory.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No giving recorded.
              </p>
            ) : (
              givingByCategory.map((g, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{g.name ?? "Uncategorised"}</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(Number(g.total), c.currency)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent services */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="text-primary size-5" /> Recent services
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentSessions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No attendance recorded.
              </p>
            ) : (
              recentSessions.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.serviceName ?? r.title ?? "Event"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {format(parseISO(r.date), "EEE, MMM d, yyyy")}
                    </p>
                  </div>
                  <span className="text-lg font-extrabold tabular-nums">
                    {r.total}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserCog className="text-primary size-5" /> Team ({team.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {team.map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {t.email}
                  </p>
                </div>
                <Badge
                  variant={t.baseRole === "owner" ? "default" : "secondary"}
                  className="shrink-0 capitalize"
                >
                  {t.baseRole === "owner"
                    ? "Owner"
                    : (t.customRole ?? t.baseRole)}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <ChurchTrialControls
        churchId={c.id}
        paymentWaived={c.paymentWaived}
        trialEndsAt={c.trialEndsAt ? c.trialEndsAt.toISOString() : null}
        standingLabel={standingLabel}
      />

      <ChurchDataTools churchId={c.id} churchName={c.name} />
    </div>
  );
}
