"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Activity, Building2, TrendingUp, Users } from "lucide-react";
import type { UsageOverview } from "@/lib/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon: typeof Users;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <Icon className="text-primary size-5" />
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-muted-foreground mt-1 text-xs">{sub}</p>
    </Card>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 shadow-md">
      <p className="text-muted-foreground text-xs font-medium">
        {label ? format(parseISO(label), "MMM d") : ""}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm font-bold tabular-nums">
          {p.value} <span className="text-muted-foreground text-xs font-medium">{p.dataKey}</span>
        </p>
      ))}
    </div>
  );
}

export function UsageDashboard({ overview }: { overview: UsageOverview }) {
  const maxViews = Math.max(1, ...overview.topFeatures.map((f) => f.views));

  if (!overview.hasData) {
    return (
      <Card className="border-dashed">
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-center">
          <Activity className="size-8" />
          <p className="font-medium">No usage recorded yet.</p>
          <p className="text-sm">
            Data appears here as churches use the app (pageviews are tracked from
            the moment this version is live).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active today" value={overview.dau} sub="Users (24h)" icon={Users} />
        <Stat label="Active this week" value={overview.wau} sub="Users (7d)" icon={Activity} />
        <Stat label="Active this month" value={overview.mau} sub="Users (30d)" icon={TrendingUp} />
        <Stat
          label="Active churches"
          value={overview.activeChurches30}
          sub={`${overview.activeChurches7} in the last 7 days`}
          icon={Building2}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active users &amp; activity (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={overview.trend} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="fillUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--border)" }} />
              <Area
                type="monotone"
                dataKey="users"
                stroke="var(--chart-1)"
                strokeWidth={3}
                fill="url(#fillUsers)"
                dot={false}
                activeDot={{ r: 5, fill: "var(--chart-1)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Most-used features (30 days)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.topFeatures.map((f) => (
              <div key={f.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {f.views.toLocaleString()} views · {f.churches} church
                    {f.churches === 1 ? "" : "es"}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${Math.round((f.views / maxViews) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity by plan (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Plan</th>
                    <th className="py-2 text-right font-medium">Events</th>
                    <th className="py-2 text-right font-medium">Churches</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.byPlan.map((p) => (
                    <tr key={p.plan} className="border-b last:border-0">
                      <td className="py-2 font-medium capitalize">{p.plan}</td>
                      <td className="py-2 text-right tabular-nums">
                        {p.events.toLocaleString()}
                      </td>
                      <td className="py-2 text-right tabular-nums">{p.churches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-4 text-xs">
              {overview.totalPageviews30.toLocaleString()} pageviews ·{" "}
              {overview.totalEvents30.toLocaleString()} total events in 30 days.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
