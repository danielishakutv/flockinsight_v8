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
import { CHART_MARGIN, Y_AXIS_PROPS } from "@/components/charts/axis";

type Point = { label: string; clicks: number };

/**
 * Follows per day for one short link.
 *
 * Bars rather than an area, because the data is a count of discrete events on
 * discrete days and most days are zero. An area chart draws a smooth slope
 * between Sunday's forty and Wednesday's two, which reads as a week of steady
 * traffic that did not happen — and the whole value of this chart to a church
 * is seeing that the follows all arrive on Sunday morning.
 *
 * The same reason every day in the window is present in the data even when it
 * has no row; see `linkStats` in lib/links.ts.
 */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 shadow-md">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="text-lg font-extrabold tabular-nums">
        {payload[0].value}
        <span className="text-muted-foreground ml-1 text-xs font-medium">
          {payload[0].value === 1 ? "follow" : "follows"}
        </span>
      </p>
    </div>
  );
}

export function LinkFollows({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
        />
        <YAxis {...Y_AXIS_PROPS} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey="clicks" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
