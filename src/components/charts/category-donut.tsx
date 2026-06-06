"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Slice = { name: string; value: number; color: string };

export function CategoryDonut({ data }: { data: Slice[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            stroke="var(--background)"
            strokeWidth={3}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="bg-popover rounded-lg border px-3 py-2 text-sm shadow-md">
                  <span className="font-semibold">{payload[0].name}</span>
                  <span className="ml-2 font-bold tabular-nums">
                    {payload[0].value}
                  </span>
                </div>
              ) : null
            }
          />
        </PieChart>
      </ResponsiveContainer>

      {/* center total */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold tabular-nums">{total}</span>
        <span className="text-muted-foreground text-xs font-medium">total</span>
      </div>

      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5 text-sm">
            <span
              className="size-2.5 rounded-full"
              style={{ background: d.color }}
            />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="font-bold tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
