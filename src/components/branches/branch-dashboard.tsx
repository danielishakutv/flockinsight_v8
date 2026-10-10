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
import {
  fileBranchesInBand,
  setBranchZones,
} from "@/app/(app)/branches/actions";
import {
  ALL,
  RANGES,
  UNFILED,
  rangeLabel,
  type BranchFilters,
  type BranchStat,
} from "@/lib/branches-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { useT } from "@/components/i18n-provider";
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

/**
 * "Remove from its group", as a Select value.
 *
 * A Select cannot carry an empty string, and null is what the action wants —
 * so the intent travels as a sentinel and is turned back into null at the
 * boundary.
 */
const UNFILED_PICK = "__unfile__";

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
  bands,
  filters,
  currency,
  canManage,
  report,
}: {
  rows: BranchStat[];
  totals: Totals;
  options: { zones: string[]; states: string[]; cities: string[]; countries: string[] };
  /** The HQ's own hierarchy, flattened with a depth for indenting. */
  bands: { id: string; name: string; kind: string; depth: number }[];
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
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState(filters.q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [zone, setZone] = useState("");
  const [band, setBand] = useState<string>("");

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

  /**
   * File the selected branches into a band of the network's own hierarchy.
   *
   * Separate from the free-text zone beside it, which predates this and holds
   * words churches actually typed. A band is the structured one: it nests, and
   * a report for a band includes everything underneath it.
   */
  function applyBand() {
    const ids = [...picked];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await fileBranchesInBand({
        churchIds: ids,
        bandId: band === UNFILED_PICK ? null : band,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        band === UNFILED_PICK
          ? `${ids.length} branch${ids.length === 1 ? "" : "es"} unfiled.`
          : `${ids.length} branch${ids.length === 1 ? "" : "es"} filed.`,
      );
      setPicked(new Set());
      setBand("");
      router.refresh();
    });
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

  /*
   * How many currencies the branches in view actually report in. One is the
   * normal case and the total is then exact; more than one means it cannot be
   * stated as a single figure, and the card says so.
   */
  const currencies = [...new Set(rows.map((r) => r.currency).filter(Boolean))];

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
          label={t("branches.branches")}
          value={totals.branches}
          sub={rangeLabel(filters.range)}
        />
        <Stat
          icon={Users}
          label={t("branches.members")}
          value={totals.members.toLocaleString()}
          sub={`${totals.newMembers} joined in range`}
        />
        <Stat
          icon={CalendarCheck}
          label={t("branches.averageAttendance")}
          value={avgAttendance.toLocaleString()}
          sub={`${totals.services} services recorded`}
        />
        <Stat
          icon={HandCoins}
          label={t("branches.giving")}
          value={formatMoney(totals.giving, currency)}
          /*
           * Said, rather than quietly added up. A network with churches in
           * Nigeria and in the UK had its naira and its pounds summed into one
           * number printed with one currency symbol — a figure that was not
           * true in either currency. The total still shows, because for almost
           * every network each branch reports in one currency and it is then
           * exactly right; when it is not, the subtitle says so instead of the
           * number lying.
           */
          sub={
            currencies.length > 1
              ? t("branches.mixedCurrencies", { count: currencies.length })
              : "Across the network"
          }
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.range} onValueChange={(v) => go({ range: v })}>
              <SelectTrigger size="sm" className="w-40" aria-label={t("branches.dateRange")}>
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
            {bands.length > 0 && (
              <Select
                value={filters.band || ALL}
                onValueChange={(v) => go({ band: v })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-auto min-w-44"
                  aria-label="Group"
                >
                  <SelectValue placeholder="Group" />
                </SelectTrigger>
                <SelectContent searchPlaceholder="Search groups…">
                  <SelectItem value={ALL}>All groups</SelectItem>
                  {bands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {" ".repeat(b.depth * 2)}
                      {b.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNFILED}>Not in any group</SelectItem>
                </SelectContent>
              </Select>
            )}
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
                placeholder={t("branches.findABranch")}
                className="h-9 pl-9"
              />
            </form>

            <Button variant="outline" size="sm" asChild>
              <a
                href={`/branches/export?${params.toString()}`}
                download
                title={t("branches.downloadThisViewAsA")}
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
                placeholder={t("branches.zoneNameEGNorth")}
                className="h-9 w-56"
              />
              <Button size="sm" variant="outline" onClick={applyZone} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t("branches.setZone")}
              </Button>
              {bands.length > 0 && (
                <>
                  <Select value={band} onValueChange={setBand}>
                    <SelectTrigger size="sm" className="w-48" aria-label="Group">
                      <SelectValue placeholder="Move into group…" />
                    </SelectTrigger>
                    <SelectContent searchPlaceholder="Search groups…">
                      {bands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {" ".repeat(b.depth * 2)}
                          {b.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={UNFILED_PICK}>
                        Remove from its group
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={applyBand} disabled={pending || !band}>
                    {pending && <Loader2 className="size-4 animate-spin" />}
                    {t("branches.moveIntoGroup")}
                  </Button>
                </>
              )}
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
              <p className="font-medium">{t("branches.noBranchesToShow")}</p>
              <p className="text-sm">
                {canManage
                  ? "Invite a church you already run, and its numbers appear here."
                  : "Nothing matches these filters."}
              </p>
            </div>
          ) : (
            /*
             * Eight columns of figures, so the branch name is frozen: a row of
             * numbers two screens to the right still has a church attached to
             * it.
             *
             * It used to be frozen only for people who could NOT manage the
             * network, on the grounds that the first column was the select-all
             * checkbox and freezing it "spends the width on nothing". Two
             * things were wrong with that. There was no select-all checkbox —
             * the header cell was empty — and the person who manages the
             * network is exactly the person reading eight columns of numbers
             * across a dozen branches, so they were the one losing the name.
             * The checkbox exists now, and it rides in the same frozen cell as
             * the name rather than taking a column of its own.
             */
            <ScrollableTable
              stickyFirstColumn
              hint={t("common.scrollForMore")}
              label={t("nav.branches")}
            >
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">
                      <span className="flex items-center gap-2">
                        {canManage && (
                          <input
                            type="checkbox"
                            className="accent-primary size-4"
                            aria-label={t("branches.selectAllBranches")}
                            checked={picked.size > 0 && picked.size === rows.length}
                            ref={(el) => {
                              // Some but not all: the third state a checkbox
                              // has, and the only honest one for a partial
                              // selection.
                              if (el)
                                el.indeterminate =
                                  picked.size > 0 && picked.size < rows.length;
                            }}
                            onChange={() =>
                              setPicked((prev) =>
                                prev.size === rows.length
                                  ? new Set()
                                  : new Set(rows.map((r) => r.churchId)),
                              )
                            }
                          />
                        )}
                        {t("branches.branch")}
                      </span>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">{t("branches.members")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("branches.new")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("branches.services")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("branches.avgAtt")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("branches.giving")}</th>
                    <th className="px-3 py-2 font-semibold">{t("branches.lastRecorded")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.churchId} className="hover:bg-accent/30">
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          {canManage && (
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
                              className="accent-primary mt-0.5 size-4 shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium">{r.name}</p>
                            <p className="text-muted-foreground text-xs">
                              {[r.bandPath || r.zone, r.city, r.state, r.country]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </div>
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
            </ScrollableTable>
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
