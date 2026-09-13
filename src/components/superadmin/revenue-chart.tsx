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
import { formatMoney } from "@/lib/money";

/** Money actually collected, by month. Empty months are drawn, not skipped. */
export function RevenueChart({
  data,
}: {
  data: { month: string; total: number }[];
}) {
  const rows = data.map((d) => ({
    ...d,
    label: new Date(`${d.month}-02`).toLocaleDateString(undefined, {
      month: "short",
    }),
  }));

  return (
    <div className="bg-card rounded-2xl border p-4">
      <p className="text-sm font-bold">Collected by month</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Counted on the day the money arrived, not the day it was recorded.
      </p>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={12}
            />
            <YAxis {...Y_AXIS_PROPS} />
            <Tooltip
              formatter={(v) => formatMoney(Number(v) || 0)}
              labelFormatter={(l) => String(l ?? "")}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--card)",
                fontSize: 12,
              }}
            />
            <Bar dataKey="total" radius={[6, 6, 0, 0]} fill="var(--primary)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
