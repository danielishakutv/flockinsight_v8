"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCheck,
  Download,
  HandCoins,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { setBranchZones } from "@/app/(app)/branches/actions";
import {
  ALL,
  RANGES,
  rangeLabel,
  type BranchFilters,
  type BranchStat,
} from "@/lib/branches-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BranchReportSettings } from "@/components/branches/branch-report-settings";
import { InviteBranchDialog } from "@/components/branches/invite-branch-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Totals = {
  branches: number;
  members: number;
  newMembers: number;
  services: number;
  attendanceTotal: number;
  giving: number;
};

export function BranchDashboard({
  rows,
  totals,
  options,
  filters,
  currency,
  canManage,
  report,
}: {
  rows: BranchStat[];
  totals: Totals;
  options: { zones: string[]; states: string[]; cities: string[]; countries: string[] };
  filters: BranchFilters;
  currency: string;
  canManage: boolean;
  report: {
    enabled: boolean;
    frequency: "weekly" | "monthly";
    recipients: string[];
    lastSentAt: string | null;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState(filters.q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [zone, setZone] = useState("");

  // Keep the box in step when the URL changes under us.
  const [lastQ, setLastQ] = useState(filters.q);
  if (lastQ !== filters.q) {
    setLastQ(filters.q);
    setTerm(filters.q);
  }

  function go(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === ALL) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`/branches?${sp.toString()}`);
  }

  function applyZone() {
    const ids = [...picked];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await setBranchZones({ churchIds: ids, zone });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        zone.trim()
          ? `${ids.length} branch${ids.length === 1 ? "" : "es"} moved to ${zone.trim()}.`
          : `Zone cleared on ${ids.length} branch${ids.length === 1 ? "" : "es"}.`,
      );
      setPicked(new Set());
      setZone("");
      router.refresh();
    });
  }

  const avgAttendance = totals.services
    ? Math.round(totals.attendanceTotal / totals.services)
    : 0;

  const filterPicker = (
    label: string,
    key: "zone" | "state" | "city" | "country",
    values: string[],
  ) =>
    values.length > 0 && (
      <Select
        value={filters[key] || ALL}
        onValueChange={(v) => go({ [key]: v })}
      >
        <SelectTrigger size="sm" className="w-auto min-w-32" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent searchPlaceholder={`Search ${label.toLowerCase()}…`}>
          <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

  return (
    <div className="space-y-5">
      {/* Roll-up */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={MapPin}
          label="Branches"
          value={totals.branches}
          sub={rangeLabel(filters.range)}
        />
        <Stat
          icon={Users}
          label="Members"
          value={totals.members.toLocaleString()}
          sub={`${totals.newMembers} joined in range`}
        />
        <Stat
          icon={CalendarCheck}
          label="Average attendance"
          value={avgAttendance.toLocaleString()}
          sub={`${totals.services} services recorded`}
        />
        <Stat
          icon={HandCoins}
          label="Giving"
          value={formatMoney(totals.giving, currency)}
          sub="Across the network"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.range} onValueChange={(v) => go({ range: v })}>
              <SelectTrigger size="sm" className="w-40" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filterPicker("Zones", "zone", options.zones)}
            {filterPicker("States", "state", options.states)}
            {filterPicker("Cities", "city", options.cities)}
            {filterPicker("Countries", "country", options.countries)}

            <form
              className="relative min-w-48 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                go({ q: term.trim() || null });
              }}
            >
              <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Find a branch…"
                className="h-9 pl-9"
              />
            </form>

            <Button variant="outline" size="sm" asChild>
              <a
                href={`/branches/export?${params.toString()}`}
                download
                title="Download this view as a spreadsheet"
              >
                <Download className="size-4" /> Export
              </a>
            </Button>
            {canManage && <InviteBranchDialog />}
          </div>

          {picked.size > 0 && canManage && (
            <div className="bg-accent/50 flex flex-wrap items-center gap-2 rounded-xl border p-2.5">
              <span className="text-sm font-semibold">{picked.size} selected</span>
              <Input
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="Zone name, e.g. North Zone"
                className="h-9 w-56"
              />
              <Button size="sm" onClick={applyZone} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Set zone
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Branch table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} branch{rows.length === 1 ? "" : "es"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="text-muted-foreground px-4 py-12 text-center">
              <Sparkles className="mx-auto mb-2 size-7 opacity-40" />
              <p className="font-medium">No branches to show</p>
              <p className="text-sm">
                {canManage
                  ? "Invite a church you already run, and its numbers appear here."
                  : "Nothing matches these filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    {canManage && <th className="w-8 px-3 py-2" />}
                    <th className="px-3 py-2 font-semibold">Branch</th>
                    <th className="px-3 py-2 text-right font-semibold">Members</th>
                    <th className="px-3 py-2 text-right font-semibold">New</th>
                    <th className="px-3 py-2 text-right font-semibold">Services</th>
                    <th className="px-3 py-2 text-right font-semibold">Avg att.</th>
                    <th className="px-3 py-2 text-right font-semibold">Giving</th>
                    <th className="px-3 py-2 font-semibold">Last recorded</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.churchId} className="hover:bg-accent/30">
                      {canManage && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={picked.has(r.churchId)}
                            onChange={() =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.churchId)) next.delete(r.churchId);
                                else next.add(r.churchId);
                                return next;
                              })
                            }
                            aria-label={`Select ${r.name}`}
                            className="accent-primary size-4"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {[r.zone, r.city, r.state, r.country]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.members.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.newMembers ? `+${r.newMembers}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.services}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.attendanceAvg ? r.attendanceAvg.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.giving ? formatMoney(r.giving, r.currency) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-xs",
                          r.lastActivity ? "text-muted-foreground" : "text-destructive",
                        )}
                      >
                        {r.lastActivity ?? "Nothing in range"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && <BranchReportSettings initial={report} />}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <div className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-semibold uppercase">
            {label}
          </p>
          <p className="truncate text-xl font-extrabold tabular-nums">{value}</p>
          {sub && <p className="text-muted-foreground truncate text-xs">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
