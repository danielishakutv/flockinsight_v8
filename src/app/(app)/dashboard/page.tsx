import Link from "next/link";
import { Suspense } from "react";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  ChevronRight,
  HandCoins,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { db } from "@/db";
import {
  attendanceSession,
  giving,
  givingCategory,
  member,
  service,
  staff,
  todo,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  getLastSession,
  getWeeklySeries,
  growthPct,
  weeklyAverage,
} from "@/lib/attendance-metrics";
import { formatMoney } from "@/lib/money";
import { siteUrl, churchPath } from "@/lib/site";
import { PageContainer } from "@/components/app/page-header";
import { DateTime } from "@/components/app/date-time";
import { StatCard } from "@/components/app/stat-card";
import { SetupNotices, type Notice } from "@/components/dashboard/setup-notices";
import { MiniTodo } from "@/components/dashboard/mini-todo";
import { UpcomingBirthdays } from "@/components/dashboard/upcoming-birthdays";
import { UpcomingAnniversaries } from "@/components/dashboard/upcoming-anniversaries";
import { InviteCard } from "@/components/dashboard/invite-card";
import { AttendanceTrend } from "@/components/charts/attendance-trend";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, church } = await requireChurch();

  const now = new Date();
  const fmtMonthStart = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const startOfMonth = fmtMonthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const startOfPrevMonth = fmtMonthStart(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  );
  const sumAmount = sql<number>`coalesce(sum(${giving.amount}), 0)`;

  const [
    series,
    last,
    [{ memberCount }],
    recent,
    [givingAgg],
    [{ servicesCount }],
    [{ givingCatCount }],
    [{ staffCount }],
    todos,
    canSettings,
    canTeam,
  ] = await Promise.all([
    getWeeklySeries(church.id, 12),
    getLastSession(church.id),
    db.select({ memberCount: count() }).from(member).where(eq(member.churchId, church.id)),
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
      .where(eq(attendanceSession.churchId, church.id))
      .orderBy(desc(attendanceSession.date), desc(attendanceSession.createdAt))
      .limit(5),
    db
      .select({
        month: sql<number>`coalesce(sum(${giving.amount}) filter (where ${giving.date} >= ${startOfMonth}), 0)`,
        prev: sql<number>`coalesce(sum(${giving.amount}) filter (where ${giving.date} >= ${startOfPrevMonth} and ${giving.date} < ${startOfMonth}), 0)`,
        total: sumAmount,
      })
      .from(giving)
      .where(eq(giving.churchId, church.id)),
    db.select({ servicesCount: count() }).from(service).where(eq(service.churchId, church.id)),
    db
      .select({ givingCatCount: count() })
      .from(givingCategory)
      .where(eq(givingCategory.churchId, church.id)),
    db.select({ staffCount: count() }).from(staff).where(eq(staff.organizationId, church.id)),
    db
      .select({ id: todo.id, text: todo.text, done: todo.done })
      .from(todo)
      .where(eq(todo.userId, user.id))
      .orderBy(asc(todo.done), desc(todo.createdAt))
      .limit(50),
    can("settings.manage"),
    can("team.manage"),
  ]);

  const avg = weeklyAverage(series, 8);
  const growth = growthPct(series, 4);
  const firstTimers4w = series.slice(-4).reduce((a, w) => a + w.firstTimers, 0);

  const givingMonth = Number(givingAgg?.month ?? 0);
  const givingPrev = Number(givingAgg?.prev ?? 0);
  const hasGiving = Number(givingAgg?.total ?? 0) > 0;
  const givingDelta =
    givingPrev > 0
      ? Math.round(((givingMonth - givingPrev) / givingPrev) * 100)
      : null;

  // "Things not yet done" setup notices (dismissible client-side).
  const notices: Notice[] = [];
  if (canSettings && Number(servicesCount) === 0)
    notices.push({
      id: "services",
      title: "Add your services",
      body: "Set up the services you run so you can record attendance.",
      cta: { label: "Add services", href: "/settings/services" },
    });
  if (canSettings && Number(givingCatCount) === 0)
    notices.push({
      id: "giving-setup",
      title: "Set up giving",
      body: "Create giving categories like Tithe and Offering to start recording.",
      cta: { label: "Set up giving", href: "/settings/giving" },
    });
  if (canTeam && Number(staffCount) <= 1)
    notices.push({
      id: "invite-team",
      title: "Invite your team",
      body: "Add pastors and admins so others can help manage the church.",
      cta: { label: "Invite team", href: "/settings/team" },
    });

  return (
    <PageContainer>
      <SetupNotices notices={notices} />

      <div className="mb-5">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Welcome back, {user.name.split(" ")[0]} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          Here&apos;s how {church.name} is doing.
        </p>
        <DateTime className="text-muted-foreground mt-2" />
      </div>

      <div className="grid gap-4 lg:gap-6 xl:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 xl:col-span-2">
          {!last ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
                  <CalendarDays className="size-8" />
                </div>
                <div>
                  <p className="text-lg font-semibold">
                    No attendance recorded yet
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Record your first service to unlock insights.
                  </p>
                </div>
                <Button asChild size="lg">
                  <Link href="/attendance/record">
                    <Plus className="size-5" />
                    Record attendance
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:gap-4">
                <StatCard
                  label="Last service"
                  value={last.total}
                  sub={`${last.name} · ${format(parseISO(last.date), "MMM d")}`}
                  icon={Users}
                  accent
                />
                <StatCard
                  label="Weekly average"
                  value={avg}
                  sub="Last 8 weeks"
                  icon={CalendarDays}
                  delta={growth}
                />
                <StatCard
                  label="Total members"
                  value={memberCount}
                  sub="In your congregation"
                  icon={UsersRound}
                />
                <StatCard
                  label="First-timers"
                  value={firstTimers4w}
                  sub="Last 4 weeks"
                  icon={Sparkles}
                />
              </div>

              {hasGiving && (
                <Link
                  href="/giving"
                  className="block transition-transform hover:-translate-y-0.5"
                >
                  <StatCard
                    label="Giving this month"
                    value={formatMoney(givingMonth, church.currency)}
                    sub={`${format(now, "MMMM yyyy")} · tap to view giving`}
                    icon={HandCoins}
                    delta={givingDelta}
                  />
                </Link>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <TrendingUp className="text-primary size-5" />
                    Attendance trend
                  </CardTitle>
                  <CardDescription>Weekly total · last 12 weeks</CardDescription>
                </CardHeader>
                <CardContent>
                  <AttendanceTrend
                    data={series.map((s) => ({ label: s.label, total: s.total }))}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-lg">Recent services</CardTitle>
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/attendance">
                      View all
                      <ChevronRight className="size-4" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {recent.map((r) => (
                    <Link
                      key={r.id}
                      href={`/attendance/${r.id}/edit`}
                      className="hover:bg-accent flex items-center gap-3 rounded-xl px-2 py-2 transition-colors"
                    >
                      <div className="bg-muted grid size-11 shrink-0 place-items-center rounded-lg text-center leading-none">
                        <span className="text-muted-foreground text-[9px] font-bold uppercase">
                          {format(parseISO(r.date), "EEE")}
                        </span>
                        <span className="text-base font-extrabold">
                          {format(parseISO(r.date), "d")}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">
                          {r.serviceName ?? r.title ?? "Event"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {format(parseISO(r.date), "MMM d, yyyy")}
                        </p>
                      </div>
                      <span className="text-xl font-extrabold tabular-nums">
                        {r.total}
                      </span>
                      <ChevronRight className="text-muted-foreground size-4" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Right column: personal to-do + birthdays + anniversaries */}
        <aside className="space-y-4">
          {church.publicEnabled && church.handle && (
            <InviteCard
              url={`${siteUrl()}${churchPath(church.handle)}`}
              churchName={church.name}
            />
          )}
          <MiniTodo initial={todos} />
          <Suspense fallback={null}>
            <UpcomingBirthdays churchId={church.id} />
          </Suspense>
          <Suspense fallback={null}>
            <UpcomingAnniversaries churchId={church.id} />
          </Suspense>
        </aside>
      </div>
    </PageContainer>
  );
}
