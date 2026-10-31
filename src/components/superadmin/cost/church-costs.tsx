"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownUp } from "lucide-react";
import { BUCKET_LABEL, SERVE_BUCKETS, type ChurchRow, type ChurchStatus } from "@/lib/cost-to-serve-shared";
import { formatMoney } from "@/lib/money";
import { formatBytes } from "@/lib/storage-bytes";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { cn } from "@/lib/utils";

type SortKey = "margin" | "revenue" | "cost" | "smsPages" | "storageBytes" | "members";

const STATUS: Record<ChurchStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  paying: { label: "Paying", variant: "default" },
  trial: { label: "Trial", variant: "secondary" },
  free: { label: "Not paying", variant: "outline" },
};

/** The bucket that costs this church the most, in words: what to look at first. */
function biggest(r: ChurchRow): string {
  const top = SERVE_BUCKETS.map((b) => ({ b, n: r.costBy[b] })).sort((x, y) => y.n - x.n)[0];
  return top && top.n > 0 ? `${BUCKET_LABEL[top.b]} ${formatMoney(top.n)}` : "—";
}

export function ChurchCosts({ rows, months }: { rows: ChurchRow[]; months: number }) {
  const [status, setStatus] = useState<ChurchStatus | "all">("all");
  const [losing, setLosing] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("margin");
  const [asc, setAsc] = useState(true);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (status === "all" || r.status === status) && (!losing || r.margin < 0) && (!needle || r.name.toLowerCase().includes(needle)))
      .sort((a, b) => (asc ? a[sort] - b[sort] : b[sort] - a[sort]));
  }, [rows, status, losing, q, sort, asc]);

  const totals = shown.reduce((t, r) => ({ revenue: t.revenue + r.revenue, cost: t.cost + r.cost }), { revenue: 0, cost: 0 });

  function by(k: SortKey) {
    if (sort === k) setAsc(!asc);
    else {
      setSort(k);
      setAsc(k === "margin");
    }
  }

  const th = (k: SortKey, children: string) => (
    <th key={k} className="px-3 py-2 text-right font-medium">
      <button type="button" onClick={() => by(k)} className={cn("inline-flex items-center gap-1", sort === k && "text-foreground")}>
        {children}
        <ArrowDownUp className="size-3 opacity-50" />
      </button>
    </th>
  );

  return (
    <section className="bg-card rounded-2xl border">
      <div className="space-y-3 p-4">
        <div>
          <p className="text-sm font-bold">Every church: what it paid, what it cost</p>
          <p className="text-muted-foreground mt-0.5 max-w-3xl text-xs">
            Cost to serve is their own SMS, AI, meetings and fees, plus their share of each bill by the rule set on it. Winning them
            (Partner commission, referral credit) is shown apart: it was spent once, not every month.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "paying", "trial", "free"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                status === s ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "All" : STATUS[s].label}
            </button>
          ))}
          <label className="text-muted-foreground ml-1 flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={losing} onChange={(e) => setLosing(e.target.checked)} />
            Only those costing more than they pay
          </label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a church" className="ml-auto h-8 w-full sm:w-56" />
        </div>
      </div>
      <ScrollableTable>
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="text-muted-foreground border-y text-xs">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Church</th>
              {th("revenue", "Paid")}
              {th("cost", "Cost to serve")}
              {th("margin", "Left over")}
              <th className="px-3 py-2 text-left font-medium">Biggest cost</th>
              {th("smsPages", "SMS pages")}
              {th("storageBytes", "Storage")}
              {th("members", "Members")}
              <th className="px-4 py-2 text-right font-medium">To win</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/superadmin/churches/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant={STATUS[r.status].variant} className="px-1.5 py-0 text-[10px]">
                      {STATUS[r.status].label}
                    </Badge>
                    {r.planLabel} · {r.channel === "direct" ? "source unknown" : `via ${r.channel}`} · active {r.activeMonths}/{months} mo
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.cost)}</td>
                <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", r.margin < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {r.margin < 0 ? "−" : ""}
                  {formatMoney(Math.abs(r.margin))}
                  {r.marginPct != null && <span className="text-muted-foreground block text-xs font-normal">{r.marginPct}%</span>}
                </td>
                <td className="text-muted-foreground px-3 py-2.5 text-xs">{biggest(r)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.smsPages.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.storageBytes ? formatBytes(r.storageBytes) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.members.toLocaleString()}</td>
                <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">{r.acquisition ? formatMoney(r.acquisition) : "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="text-muted-foreground p-6 text-center">
                  No church matches.
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t text-xs font-semibold">
              <tr>
                <td className="px-4 py-2">{shown.length} churches</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.cost)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", totals.revenue - totals.cost < 0 && "text-red-600 dark:text-red-400")}>
                  {formatMoney(totals.revenue - totals.cost)}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollableTable>
    </section>
  );
}
