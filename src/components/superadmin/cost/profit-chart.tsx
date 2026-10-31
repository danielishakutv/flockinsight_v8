"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_MARGIN, Y_AXIS_PROPS } from "@/components/charts/axis";
import { formatMoney } from "@/lib/money";
import { monthLabel, type MonthPoint } from "@/lib/cost-to-serve-shared";
import { cn } from "@/lib/utils";

/**
 * Revenue beside everything it cost, month by month, on one naira axis.
 * Profit is the gap between the pair; the tooltip and the table under the
 * chart say it in figures.
 */
export function ProfitChart({ data, partialMonth }: { data: MonthPoint[]; partialMonth: string | null }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month).replace(/ \d{4}$/, "") + (d.month === partialMonth ? "*" : "") }));
  return (
    <div className="bg-card rounded-2xl border p-4">
      <p className="text-sm font-bold">Revenue and costs, last 12 months</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Plan payments spread over the months they pay for, against every cost.
        {partialMonth ? " * This month so far: usage is still coming in." : ""}
      </p>
      <div className="mt-4 h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={CHART_MARGIN} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis {...Y_AXIS_PROPS} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as (MonthPoint & { label: string }) | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="bg-card rounded-xl border px-3 py-2 text-xs shadow-sm">
                    <p className="font-semibold">{monthLabel(p.month, true)}</p>
                    <p>Revenue {formatMoney(p.revenue)}</p>
                    <p>Costs {formatMoney(p.costs)}</p>
                    <p className={cn("font-semibold", p.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                      {p.profit < 0 ? "Loss" : "Profit"} {formatMoney(Math.abs(p.profit))}
                    </p>
                  </div>
                );
              }}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Bar name="Revenue" dataKey="revenue" radius={[4, 4, 0, 0]} fill="var(--primary)" />
            <Bar name="Costs" dataKey="costs" radius={[4, 4, 0, 0]} fill="var(--muted-foreground)" fillOpacity={0.55} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs">
        <summary className="text-muted-foreground cursor-pointer">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-right tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Month</th>
                <th className="py-1 font-medium">Revenue</th>
                <th className="py-1 font-medium">Cost to serve</th>
                <th className="py-1 font-medium">All costs</th>
                <th className="py-1 font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-t">
                  <td className="py-1 text-left">{monthLabel(d.month)}</td>
                  <td className="py-1">{formatMoney(d.revenue)}</td>
                  <td className="py-1">{formatMoney(d.serve)}</td>
                  <td className="py-1">{formatMoney(d.costs)}</td>
                  <td className={cn("py-1 font-medium", d.profit < 0 && "text-red-600 dark:text-red-400")}>{formatMoney(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
