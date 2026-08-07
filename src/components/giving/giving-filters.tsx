"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type GivingFilterState = {
  q: string;
  categoryId: string;
  method: string;
  projectId: string;
  from: string;
  to: string;
};

type Option = { id: string; name: string };

/** Select can't hold "" as a value, so "any" gets its own sentinel. */
const ANY = "__any__";
/** Mirrors GIVING_FILTER_NONE on the server. */
const NONE = "none";

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "transfer", label: "Transfer" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "online", label: "Online" },
  { value: "other", label: "Other" },
];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function iso(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Quick date ranges, evaluated against the church's "today". */
function presets(today: string) {
  const now = new Date(`${today}T00:00:00`);
  const thisMonth = startOfMonth(now);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const last30 = new Date(now);
  last30.setDate(last30.getDate() - 29);

  return [
    { label: "This month", from: iso(thisMonth), to: today },
    { label: "Last month", from: iso(lastMonth), to: iso(lastMonthEnd) },
    { label: "Last 30 days", from: iso(last30), to: today },
    { label: "This year", from: `${now.getFullYear()}-01-01`, to: today },
    {
      label: "Last year",
      from: `${now.getFullYear() - 1}-01-01`,
      to: `${now.getFullYear() - 1}-12-31`,
    },
  ];
}

export function GivingFilters({
  value,
  categories,
  projects,
  today,
  resultCount,
  resultTotalLabel,
}: {
  value: GivingFilterState;
  categories: Option[];
  projects: Option[];
  today: string;
  resultCount: number;
  resultTotalLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(value.q);
  const [open, setOpen] = useState(false);

  // A debounced keystroke fires up to 400ms late — long enough for the user to
  // have picked a filter meanwhile. Read the current filters through a ref so
  // the delayed push builds on them instead of on a stale snapshot.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });

  // The search box drives the URL, so remember what we last sent to avoid
  // re-pushing the same query on every re-render.
  const pushedQ = useRef(value.q);

  // The URL changed underneath us (back/forward, or "Clear all") — adopt it.
  useEffect(() => {
    if (value.q !== pushedQ.current) {
      pushedQ.current = value.q;
      setQ(value.q);
    }
  }, [value.q]);

  const activeCount =
    (value.categoryId ? 1 : 0) +
    (value.method ? 1 : 0) +
    (value.projectId ? 1 : 0) +
    (value.from || value.to ? 1 : 0);
  const anyFilter = activeCount > 0 || Boolean(value.q);

  function apply(patch: Partial<GivingFilterState>) {
    const next = { ...latest.current, ...patch };
    const sp = new URLSearchParams();
    if (next.q) sp.set("q", next.q);
    if (next.categoryId) sp.set("cat", next.categoryId);
    if (next.method) sp.set("method", next.method);
    if (next.projectId) sp.set("project", next.projectId);
    if (next.from) sp.set("from", next.from);
    if (next.to) sp.set("to", next.to);
    // Any change to the filters puts you back on page one.
    const qs = sp.toString();
    start(() => router.push(`/giving${qs ? `?${qs}` : ""}`, { scroll: false }));
  }

  // Debounce typing so the ledger doesn't re-query on every keystroke.
  useEffect(() => {
    if (q === pushedQ.current) return;
    const t = setTimeout(() => {
      pushedQ.current = q;
      apply({ q });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function clearAll() {
    setQ("");
    pushedQ.current = "";
    start(() => router.push("/giving", { scroll: false }));
  }

  const categoryLabel =
    value.categoryId === NONE
      ? "Uncategorised"
      : categories.find((c) => c.id === value.categoryId)?.name;
  const projectLabel =
    value.projectId === NONE
      ? "No project"
      : projects.find((p) => p.id === value.projectId)?.name;
  const rangeLabel =
    value.from && value.to
      ? `${value.from} → ${value.to}`
      : value.from
        ? `From ${value.from}`
        : value.to
          ? `Until ${value.to}`
          : "";

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search giver, note, amount…"
            className="pl-9"
            aria-label="Search giving records"
          />
          {(pending || q) && (
            <span className="absolute top-1/2 right-2 -translate-y-1/2">
              {pending ? (
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              ) : (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQ("")}
                  className="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded-md"
                >
                  <X className="size-4" />
                </button>
              )}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant={activeCount > 0 ? "default" : "outline"}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span className="bg-background/25 grid size-5 place-items-center rounded-full text-xs font-bold">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      {open && (
        <div className="bg-card space-y-4 rounded-2xl border p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={value.categoryId || ANY}
                onValueChange={(v) =>
                  apply({ categoryId: v === ANY ? "" : v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ANY}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NONE}>Uncategorised</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Method</Label>
              <Select
                value={value.method || ANY}
                onValueChange={(v) => apply({ method: v === ANY ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All methods</SelectItem>
                  {METHOD_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Project</Label>
              <Select
                value={value.projectId || ANY}
                onValueChange={(v) => apply({ projectId: v === ANY ? "" : v })}
                disabled={projects.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ANY}>All giving</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NONE}>Not toward a project</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Date range</Label>
            <div className="flex flex-wrap gap-2">
              {presets(today).map((p) => {
                const on = value.from === p.from && value.to === p.to;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() =>
                      apply(on ? { from: "", to: "" } : { from: p.from, to: p.to })
                    }
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="from" className="text-muted-foreground text-xs">
                  From
                </Label>
                <Input
                  id="from"
                  type="date"
                  value={value.from}
                  max={value.to || undefined}
                  onChange={(e) => apply({ from: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to" className="text-muted-foreground text-xs">
                  To
                </Label>
                <Input
                  id="to"
                  type="date"
                  value={value.to}
                  min={value.from || undefined}
                  onChange={(e) => apply({ to: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* What's currently narrowing the list, each individually removable. */}
      {anyFilter && (
        <div className="flex flex-wrap items-center gap-2">
          {value.q && (
            <Chip label={`“${value.q}”`} onClear={() => setQ("")} />
          )}
          {categoryLabel && (
            <Chip
              label={categoryLabel}
              onClear={() => apply({ categoryId: "" })}
            />
          )}
          {value.method && (
            <Chip
              label={
                METHOD_OPTIONS.find((m) => m.value === value.method)?.label ??
                value.method
              }
              onClear={() => apply({ method: "" })}
            />
          )}
          {projectLabel && (
            <Chip
              label={projectLabel}
              onClear={() => apply({ projectId: "" })}
            />
          )}
          {rangeLabel && (
            <Chip
              label={rangeLabel}
              onClear={() => apply({ from: "", to: "" })}
            />
          )}
          <button
            type="button"
            onClick={clearAll}
            className="text-primary text-sm font-semibold hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        {anyFilter ? (
          <>
            <span className="text-foreground font-semibold">
              {resultCount} match{resultCount === 1 ? "" : "es"}
            </span>{" "}
            · {resultTotalLabel}
          </>
        ) : (
          <>
            {resultCount} record{resultCount === 1 ? "" : "s"} ·{" "}
            {resultTotalLabel}
          </>
        )}
      </p>
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="bg-primary/10 text-primary inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-sm font-semibold">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="hover:bg-primary/20 grid size-5 shrink-0 place-items-center rounded-full"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
