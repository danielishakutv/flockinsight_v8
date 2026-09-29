"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { CHART_MARGIN, Y_AXIS_PROPS } from "@/components/charts/axis";
import { readability, readabilityNote, seriesSample } from "@/lib/thin-data";

export type GrowthPoint = {
  day: string;
  signups: number;
  activeChurches: number;
  revenue: number;
};

type SeriesKey = "activeChurches" | "signups" | "revenue";

const SERIES: Record<
  SeriesKey,
  { label: string; color: string; money?: boolean }
> = {
  activeChurches: { label: "Active churches", color: "var(--chart-1)" },
  signups: { label: "New signups", color: "var(--chart-2)" },
  revenue: { label: "Revenue", color: "var(--chart-3)", money: true },
};

function GrowthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 shadow-md">
      <p className="text-muted-foreground text-xs font-medium">
        {label ? format(parseISO(label), "EEE, d MMM yyyy") : ""}
      </p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-sm">
          <span
            className="size-2.5 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-bold tabular-nums">
            {p.value?.toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * 90-day platform growth. One series at a time keeps the scales honest.
 *
 * The verdict is recomputed per series, because they thin out at different
 * rates: ninety days of active churches is a real line while ninety days of
 * revenue is nine payments and eighty-one zeroes, and drawing the second the
 * same way as the first is how a flat axis with one spike at the end reads as
 * growth.
 */
export function GrowthChart({
  data,
  churches,
}: {
  data: GrowthPoint[];
  /** Churches contributing, so the sample is honest about its real width. */
  churches: number;
}) {
  const [key, setKey] = useState<SeriesKey>("activeChurches");
  const series = SERIES[key];

  const sample = seriesSample(
    data.map((d) => d[key]),
    churches,
  );
  const verdict = readability(sample, "series");

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(SERIES) as SeriesKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKey(k)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold transition",
              k === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {SERIES[k].label}
          </button>
        ))}
      </div>

      {verdict !== "solid" && (
        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          {readabilityNote(verdict, "series")}{" "}
          {sample.n} of {data.length} days carry a value.
        </p>
      )}

      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={40}
            tickFormatter={(v: string) => format(parseISO(v), "d MMM")}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            {...Y_AXIS_PROPS}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            content={<GrowthTooltip />}
            cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.3 }}
          />
          <Area
            type="monotone"
            dataKey={key}
            name={series.label}
            stroke={series.color}
            strokeWidth={2}
            fill="url(#growthFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type BurnPoint = { fetchedAt: string; balance: number };

/** Termii balance over the last 30 days — the shape of the drawdown. */
export function BurnChart({ data }: { data: BurnPoint[] }) {
  if (data.length < 2) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Not enough readings yet — the burn chart needs a few hours of history.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="fetchedAt"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
          tickFormatter={(v: string) => format(new Date(v), "d MMM")}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          {...Y_AXIS_PROPS}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
        />
        <Tooltip
          content={<GrowthTooltip />}
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.3 }}
        />
        <Area
          type="monotone"
          dataKey="balance"
          name="Termii balance"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#burnFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
