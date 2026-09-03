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
import {
  activeFilterCount,
  financeFilterQuery,
  financePresets,
  FINANCE_FILTER_NONE,
  KIND_LABEL,
  METHOD_LABEL,
  FINANCE_METHODS,
  type FinanceFilterState,
} from "@/lib/finance-shared";

type Option = { id: string; name: string };

/** Select cannot hold "" as a value, so "any" gets its own sentinel. */
const ANY = "__any__";

export function FinanceFilters({
  value,
  accounts,
  categories,
  today,
  resultCount,
  resultSummary,
}: {
  value: FinanceFilterState;
  accounts: Option[];
  categories: Option[];
  today: string;
  resultCount: number;
  resultSummary: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(value.q);
  const [open, setOpen] = useState(false);

  // A debounced keystroke lands up to 400ms late, by which time the person may
  // have picked a filter. Read the current filters through a ref so the delayed
  // push builds on them rather than on a stale snapshot.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });

  const pushedQ = useRef(value.q);

  // The URL changed underneath us (back/forward, or "Clear all") — adopt it.
  useEffect(() => {
    if (value.q !== pushedQ.current) {
      pushedQ.current = value.q;
      setQ(value.q);
    }
  }, [value.q]);

  function apply(patch: Partial<FinanceFilterState>) {
    const next = { ...latest.current, ...patch };
    const qs = financeFilterQuery(next);
    start(() =>
      router.push(`/finance${qs ? `?${qs}` : ""}`, { scroll: false }),
    );
  }

  // Debounce typing so the ledger does not re-query on every keystroke.
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
    start(() => router.push("/finance", { scroll: false }));
  }

  const count = activeFilterCount(value);
  const anyFilter = count > 0 || Boolean(value.q);

  const accountLabel =
    value.accountId === FINANCE_FILTER_NONE
      ? "No account"
      : accounts.find((a) => a.id === value.accountId)?.name;
  const categoryLabel =
    value.categoryId === FINANCE_FILTER_NONE
      ? "Uncategorised"
      : categories.find((c) => c.id === value.categoryId)?.name;
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
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search payee, reference, note or amount…"
            className="pl-9"
            aria-label="Search finance records"
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
          variant={count > 0 ? "default" : "outline"}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">Filters</span>
          {count > 0 && (
            <span className="bg-background/25 grid size-5 place-items-center rounded-full text-xs font-bold">
              {count}
            </span>
          )}
        </Button>
      </div>

      {open && (
        <div className="bg-card space-y-4 rounded-2xl border p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={value.kind || ANY}
                onValueChange={(v) => apply({ kind: v === ANY ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Income &amp; expense</SelectItem>
                  <SelectItem value="income">{KIND_LABEL.income}</SelectItem>
                  <SelectItem value="expense">{KIND_LABEL.expense}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Account</Label>
              <Select
                value={value.accountId || ANY}
                onValueChange={(v) => apply({ accountId: v === ANY ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  className="max-h-72"
                  searchPlaceholder="Search accounts…"
                >
                  <SelectItem value={ANY}>All accounts</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={FINANCE_FILTER_NONE}>No account</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={value.categoryId || ANY}
                onValueChange={(v) => apply({ categoryId: v === ANY ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  className="max-h-72"
                  searchPlaceholder="Search categories…"
                >
                  <SelectItem value={ANY}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={FINANCE_FILTER_NONE}>
                    Uncategorised
                  </SelectItem>
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
                  {FINANCE_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Date range</Label>
            <div className="flex flex-wrap gap-2">
              {financePresets(today).map((p) => {
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

      {anyFilter && (
        <div className="flex flex-wrap items-center gap-2">
          {value.q && <Chip label={`“${value.q}”`} onClear={() => setQ("")} />}
          {value.kind && (
            <Chip
              label={KIND_LABEL[value.kind as "income" | "expense"]}
              onClear={() => apply({ kind: "" })}
            />
          )}
          {accountLabel && (
            <Chip label={accountLabel} onClear={() => apply({ accountId: "" })} />
          )}
          {categoryLabel && (
            <Chip
              label={categoryLabel}
              onClear={() => apply({ categoryId: "" })}
            />
          )}
          {value.method && (
            <Chip
              label={METHOD_LABEL[value.method as "cash"] ?? value.method}
              onClear={() => apply({ method: "" })}
            />
          )}
          {rangeLabel && (
            <Chip label={rangeLabel} onClear={() => apply({ from: "", to: "" })} />
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
        <span className="text-foreground font-semibold">
          {resultCount} record{resultCount === 1 ? "" : "s"}
        </span>{" "}
        · {resultSummary}
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
