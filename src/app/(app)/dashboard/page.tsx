import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  ChevronRight,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { db } from "@/db";
import { attendanceSession, member, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import {
  getLastSession,
  getWeeklySeries,
  growthPct,
  weeklyAverage,
} from "@/lib/attendance-metrics";
import { PageContainer } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
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

  const [series, last, [{ memberCount }], recent] = await Promise.all([
    getWeeklySeries(church.id, 12),
    getLastSession(church.id),
    db
      .select({ memberCount: count() })
      .from(member)
      .where(eq(member.churchId, church.id)),
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
  ]);

  const avg = weeklyAverage(series, 8);
  const growth = growthPct(series, 4);
  const firstTimers4w = series.slice(-4).reduce((a, w) => a + w.firstTimers, 0);

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
            Welcome back, {user.name.split(" ")[0]} 👋
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            Here&apos;s how {church.name} is doing.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/attendance/record">
            <Plus className="size-5" />
            Record attendance
          </Link>
        </Button>
      </div>

      {!last ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
              <CalendarDays className="size-8" />
            </div>
            <div>
              <p className="text-lg font-semibold">No attendance recorded yet</p>
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
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
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

          {/* Trend chart */}
          <Card className="mt-4">
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

          {/* Recent services */}
          <Card className="mt-4">
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
    </PageContainer>
  );
}
