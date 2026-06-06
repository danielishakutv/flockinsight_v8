"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { name: string; avg: number };

export function ServiceComparison({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 56)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={140}
          tick={{ fontSize: 12, fill: "var(--foreground)" }}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="bg-popover rounded-lg border px-3 py-2 text-sm shadow-md">
                <span className="font-semibold">{label}</span>
                <span className="ml-2 font-bold tabular-nums">
                  {payload[0].value} avg
                </span>
              </div>
            ) : null
          }
        />
        <Bar
          dataKey="avg"
          fill="var(--chart-1)"
          radius={[0, 6, 6, 0]}
          maxBarSize={36}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
