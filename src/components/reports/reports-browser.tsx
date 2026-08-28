"use client";

import { useMemo, useState } from "react";
import {
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Link2,
  Package,
  Search,
} from "lucide-react";
import {
  CATEGORIES,
  type CategoryKey,
  type Dataset,
} from "@/lib/report-catalog";
import { rangeLabel, rangeQuery } from "@/lib/report-range";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Presets covering the periods people actually report on. */
const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  {
    label: "This month",
    range: () => {
      const now = new Date();
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(now),
      };
    },
  },
  {
    label: "Last 3 months",
    range: () => {
      const now = new Date();
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        to: iso(now),
      };
    },
  },
  {
    label: "This year",
    range: () => {
      const now = new Date();
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    },
  },
  {
    label: "Last year",
    range: () => {
      const y = new Date().getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function ReportsBrowser({
  datasets,
  counts,
}: {
  datasets: Dataset[];
  counts: Record<string, number>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryKey | "all">("all");

  const range = { from: from || null, to: to || null };
  const qs = rangeQuery(range);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return datasets.filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (!q) return true;
      return [d.label, d.description, d.grain, d.id].some((v) =>
        v.toLowerCase().includes(q),
      );
    });
  }, [datasets, query, category]);

  const grouped = CATEGORIES.map((c) => ({
    ...c,
    items: filtered.filter((d) => d.category === c.key),
  })).filter((c) => c.items.length > 0);

  const available = useMemo(
    () => new Set(datasets.map((d) => d.category)),
    [datasets],
  );
  const totalRows = datasets.reduce((sum, d) => sum + (counts[d.id] ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Everything, in one file. The headline action. */}
      <Card className="from-primary/10 border-primary/30 bg-gradient-to-br to-violet-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="text-primary size-5" />
            Download everything
          </CardTitle>
          <CardDescription>
            One ZIP with a spreadsheet for every dataset below —{" "}
            {totalRows.toLocaleString()} rows across {datasets.length} files — plus a
            data dictionary explaining how they join together.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 pb-0.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const r = p.range();
                    setFrom(r.from);
                    setTo(r.to);
                  }}
                >
                  {p.label}
                </Button>
              ))}
              {(from || to) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFrom("");
                    setTo("");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            Period: <span className="font-semibold">{rangeLabel(range)}</span>. The
            range applies to each dataset&apos;s own main date — a member&apos;s join
            date, a gift&apos;s date, a service&apos;s date. Reference lists like
            categories and roles are always included in full.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <a href={`/reports/bundle?x=1${qs}`}>
                <Download className="size-4" />
                Full export (ZIP of CSVs)
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={`/reports/summary?x=1${qs}`}>
                <FileText className="size-4" />
                Summary report (PDF)
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            className="pl-9"
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip
            active={category === "all"}
            onClick={() => setCategory("all")}
            label="All"
            count={datasets.length}
          />
          {CATEGORIES.filter((c) => available.has(c.key)).map((c) => (
            <FilterChip
              key={c.key}
              active={category === c.key}
              onClick={() => setCategory(c.key)}
              label={c.label}
              count={datasets.filter((d) => d.category === c.key).length}
            />
          ))}
        </div>
      </div>

      {grouped.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-center">
            No reports match “{query}”.
          </CardContent>
        </Card>
      ) : (
        grouped.map((cat) => (
          <section key={cat.key} className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Database className="text-primary size-4" />
                {cat.label}
              </h2>
              <p className="text-muted-foreground text-sm">{cat.description}</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {cat.items.map((d) => (
                <DatasetCard
                  key={d.id}
                  dataset={d}
                  count={counts[d.id] ?? 0}
                  qs={qs}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function DatasetCard({
  dataset,
  count,
  qs,
}: {
  dataset: Dataset;
  count: number;
  qs: string;
}) {
  const empty = count === 0;
  return (
    <Card className={cn(empty && "opacity-70")}>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">{dataset.label}</p>
            <p className="text-muted-foreground text-xs">{dataset.grain}</p>
          </div>
          <Badge variant={empty ? "secondary" : "success"} className="shrink-0">
            {count.toLocaleString()} {count === 1 ? "row" : "rows"}
          </Badge>
        </div>

        <p className="text-muted-foreground text-sm">{dataset.description}</p>

        <div className="space-y-1">
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <Info className="mt-0.5 size-3 shrink-0" />
            {dataset.dateColumn
              ? `Filtered by ${dataset.dateColumn.replace(/_/g, " ")}`
              : "Always exported in full — no date to filter on"}
          </p>
          {dataset.joins && dataset.joins.length > 0 && (
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <Link2 className="mt-0.5 size-3 shrink-0" />
              <span>
                Joins to{" "}
                {dataset.joins.map((j, i) => (
                  <span key={j.column}>
                    {i > 0 && ", "}
                    <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
                      {j.target}
                    </code>
                  </span>
                ))}
              </span>
            </p>
          )}
        </div>

        {/* Both stay clickable even at zero rows: the CSV still carries the
            column headers, which is what someone planning an analysis wants
            to see. (A `disabled` prop would be inert here anyway — these
            render as anchors, and an anchor cannot be disabled.) */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline">
            <a href={`/reports/download/${dataset.id}?format=csv${qs}`}>
              <FileSpreadsheet className="size-4" />
              CSV
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/reports/download/${dataset.id}?format=pdf${qs}`}>
              <FileText className="size-4" />
              PDF
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
