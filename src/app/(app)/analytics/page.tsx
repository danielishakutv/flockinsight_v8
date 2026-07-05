import Link from "next/link";
import { and, eq, gte } from "drizzle-orm";
import { CalendarDays, Sparkles, TrendingUp, UserPlus } from "lucide-react";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import {
  getWeeklySeries,
  growthPct,
  weeklyAverage,
} from "@/lib/attendance-metrics";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { SetupNotices } from "@/components/dashboard/setup-notices";
import { StatCard } from "@/components/app/stat-card";
import { AttendanceBreakdown } from "@/components/charts/attendance-breakdown";
import { CategoryDonut } from "@/components/charts/category-donut";
import { ServiceComparison } from "@/components/charts/service-comparison";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Analytics" };

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default async function AnalyticsPage() {
  const { church } = await requireChurch();
  await requireCan("analytics.view");

  const sinceStr = isoDaysAgo(7 * 12);

  const [series, raw] = await Promise.all([
    getWeeklySeries(church.id, 12),
    db
      .select({
        total: attendanceSession.totalCount,
        male: attendanceSession.maleCount,
        female: attendanceSession.femaleCount,
        teenMale: attendanceSession.teenMaleCount,
        teenFemale: attendanceSession.teenFemaleCount,
        children: attendanceSession.childrenCount,
        firstTimers: attendanceSession.firstTimerCount,
        newConverts: attendanceSession.newConvertCount,
        title: attendanceSession.title,
        serviceName: service.name,
      })
      .from(attendanceSession)
      .leftJoin(service, eq(service.id, attendanceSession.serviceId))
      .where(
        and(
          eq(attendanceSession.churchId, church.id),
          gte(attendanceSession.date, sinceStr),
        ),
      ),
  ]);

  if (raw.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Analytics" description="Trends and breakdowns." />
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
              <TrendingUp className="size-8" />
            </div>
            <p className="text-muted-foreground">
              Record a few services to see analytics here.
            </p>
            <Button asChild size="lg">
              <Link href="/attendance/record">Record attendance</Link>
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  // Aggregate
  const totals = raw.reduce(
    (a, r) => {
      a.men += r.male;
      a.women += r.female;
      a.teens += r.teenMale + r.teenFemale;
      a.children += r.children;
      a.firstTimers += r.firstTimers;
      a.newConverts += r.newConverts;
      return a;
    },
    { men: 0, women: 0, teens: 0, children: 0, firstTimers: 0, newConverts: 0 },
  );

  const perService = new Map<string, { sum: number; count: number }>();
  for (const r of raw) {
    const name = r.serviceName ?? r.title ?? "One-off";
    const e = perService.get(name) ?? { sum: 0, count: 0 };
    e.sum += r.total;
    e.count += 1;
    perService.set(name, e);
  }
  const serviceData = [...perService.entries()]
    .map(([name, e]) => ({ name, avg: Math.round(e.sum / e.count) }))
    .sort((a, b) => b.avg - a.avg);

  const avg = weeklyAverage(series, 8);
  const growth = growthPct(series, 4);

  const breakdownData = series.map((s) => ({
    label: s.label,
    men: s.male,
    women: s.female,
    teens: s.teens,
    children: s.children,
  }));

  const donutData = [
    { name: "Adult men", value: totals.men, color: "var(--chart-1)" },
    { name: "Adult women", value: totals.women, color: "var(--chart-5)" },
    { name: "Teens", value: totals.teens, color: "var(--chart-2)" },
    { name: "Children", value: totals.children, color: "var(--chart-4)" },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description="Trends, breakdowns and growth · last 12 weeks"
      />

      <SetupNotices />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Weekly average"
          value={avg}
          sub="Last 8 weeks"
          icon={CalendarDays}
          delta={growth}
        />
        <StatCard
          label="Growth"
          value={growth === null ? "—" : `${growth > 0 ? "+" : ""}${growth}%`}
          sub="vs previous 4 weeks"
          icon={TrendingUp}
          accent
        />
        <StatCard
          label="First-timers"
          value={totals.firstTimers}
          sub="Last 12 weeks"
          icon={Sparkles}
        />
        <StatCard
          label="New converts"
          value={totals.newConverts}
          sub="Last 12 weeks"
          icon={UserPlus}
        />
      </div>

      {/* Weekly breakdown */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-lg">Weekly breakdown</CardTitle>
          <CardDescription>
            Adults, teens &amp; children per week
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AttendanceBreakdown data={breakdownData} />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Demographics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Demographics</CardTitle>
            <CardDescription>Total split · last 12 weeks</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryDonut data={donutData} />
          </CardContent>
        </Card>

        {/* Service comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Average by service</CardTitle>
            <CardDescription>Mean attendance per service</CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceComparison data={serviceData} />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
