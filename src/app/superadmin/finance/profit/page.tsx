import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, TrendingDown, TrendingUp, XCircle } from "lucide-react";

import { requirePlatform, canPlatform } from "@/lib/platform-access";
import { loadCostPage, PERIODS, periodMonths, type PeriodKey } from "@/lib/cost-to-serve";
import { accuracyChecks, checksNeedingAttention, recommendations, type Insight } from "@/lib/cost-insights-shared";
import { BUCKET_LABEL, SERVE_BUCKETS, monthOf, type CostReport, type GroupRow } from "@/lib/cost-to-serve-shared";
import { getFinanceSummaryView } from "@/lib/ai/summaries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CostTabs } from "@/components/superadmin/cost/cost-tabs";
import { CostItems } from "@/components/superadmin/cost/cost-items";
import { IncomeEntries } from "@/components/superadmin/cost/income-entries";
import { ChurchCosts } from "@/components/superadmin/cost/church-costs";
import { AccuracyList } from "@/components/superadmin/cost/accuracy-list";
import { FinanceBriefing } from "@/components/superadmin/cost/finance-briefing";
import { ProfitChart } from "@/components/superadmin/cost/profit-chart";
import { ScrollableTable } from "@/components/ui/scrollable-table";

export const metadata = { title: "Cost & profit · Admin" };
export const dynamic = "force-dynamic";

/**
 * What it costs to serve the churches, and whether the platform makes money.
 * Everything measurable is read from what happened; only the bills the
 * platform cannot see are typed in. lib/cost-to-serve-shared.ts holds the
 * model and its rules.
 */
export default async function CostAndProfitPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatform("platform.finance.view");
  const sp = await searchParams;
  const period: PeriodKey = PERIODS.some((p) => p.key === sp.period) ? (sp.period as PeriodKey) : "3m";
  const now = new Date();
  const { months, label, inWords } = periodMonths(period, now);

  const [data, canManage, briefing] = await Promise.all([loadCostPage(months, inWords, now), canPlatform("platform.finance.manage"), getFinanceSummaryView()]);
  const r = data.report;
  const insights = recommendations(r, data.ctx);
  const checks = accuracyChecks(r, data.ctx);
  const a = r.acquisitionStats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/superadmin/finance" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
            <ArrowLeft className="size-3" /> Finance
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Cost & profit</h1>
          <p className="text-muted-foreground mt-1 text-sm">What serving the churches costs, what they pay, and what is left.</p>
        </div>
        <nav aria-label="Period" className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`?period=${p.key}`}
              scroll={false}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                p.key === period ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label={`Revenue · ${label}`} value={formatMoney(r.revenue.total)} sub={r.revenue.capital > 0 ? `Plus ${formatMoney(r.revenue.capital)} capital, not profit` : "Plans, wallet spend and income entered"} />
        <Stat
          label="Cost to serve"
          value={formatMoney(r.serve)}
          sub={
            r.grossMarginPct == null
              ? "Hosting, SMS, email, AI, meetings, fees"
              : r.grossMarginPct < 0
                ? `Serving costs ${(r.serve / r.revenue.total).toFixed(1)}× what churches pay`
                : `${r.grossMarginPct}% of revenue left after serving`
          }
        />
        <Stat
          label={r.profit < 0 ? "Loss" : "Profit"}
          value={formatMoney(Math.abs(r.profit))}
          sub={`After ${formatMoney(r.acquisition)} winning churches and ${formatMoney(r.overhead)} running the business`}
          tone={r.profit < 0 ? "bad" : "good"}
          icon={r.profit < 0 ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
        />
        <Stat
          label="Paying churches"
          value={`${r.breakEven.payingNow}${r.breakEven.payingNeeded != null ? ` / ${r.breakEven.payingNeeded}` : ""}`}
          sub={
            r.breakEven.payingNeeded != null
              ? r.breakEven.payingNow >= r.breakEven.payingNeeded
                ? `Past break-even: ${r.breakEven.payingNeeded} cover your bills`
                : `${r.breakEven.payingNeeded} would cover your bills`
              : "Break-even needs a paying church that leaves something over"
          }
        />
        <Stat
          label="Cost to win a paying church"
          value={a.cac != null ? formatMoney(a.cac) : "—"}
          sub={
            a.cac != null
              ? a.paybackMonths != null
                ? `Paid back in ${Math.max(1, Math.round(a.paybackMonths))} month${Math.round(a.paybackMonths) === 1 ? "" : "s"}`
                : `${a.newPaying} new paying`
              : a.newPaying > 0
                ? `${a.newPaying} new paying, no marketing recorded`
                : "No new paying church in this period"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ProfitChart data={data.series} partialMonth={monthOf(now)} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Insights insights={insights} />
        </div>
      </div>

      <FinanceBriefing view={briefing} />

      <CostTabs
        tabs={[
          {
            key: "costs",
            label: "Costs",
            content: (
              <CostItems
                items={data.items}
                measured={r.lines.filter((l) => l.basis !== "entered")}
                canManage={canManage}
                periodLabel={label}
                ngnPerUsd={data.rate.ngnPerUsd}
              />
            ),
          },
          {
            key: "income",
            label: "Income",
            content: <IncomeEntries entries={data.income} revenue={r.revenue} churches={data.churchOptions} canManage={canManage} />,
          },
          { key: "churches", label: "Churches", content: <ChurchCosts rows={r.churches} months={r.months.length} /> },
          { key: "plans", label: "Plans", content: <Plans report={r} /> },
          { key: "features", label: "Features", content: <Features report={r} /> },
          { key: "acquisition", label: "Winning churches", content: <Acquisition report={r} /> },
          {
            key: "accuracy",
            label: "Accuracy",
            badge: checksNeedingAttention(checks),
            content: <AccuracyList checks={checks} canManage={canManage} ngnPerUsd={data.rate.ngnPerUsd} ownRate={data.rate.own} />,
          },
        ]}
      />
    </div>
  );
}

function Stat({ label, value, sub, tone, icon }: { label: string; value: string; sub: string; tone?: "good" | "bad"; icon?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-2 text-2xl font-extrabold tracking-tight tabular-nums",
          tone === "bad" && "text-red-600 dark:text-red-400",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-1 text-xs text-balance">{sub}</p>
    </div>
  );
}

const TONE = {
  bad: { icon: XCircle, cls: "border-red-500/30 bg-red-500/5", ico: "text-red-600 dark:text-red-400", word: "Problem" },
  warn: { icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/5", ico: "text-amber-600 dark:text-amber-400", word: "Look at this" },
  good: { icon: CheckCircle2, cls: "border-emerald-500/30 bg-emerald-500/5", ico: "text-emerald-600 dark:text-emerald-400", word: "Going well" },
  info: { icon: Info, cls: "", ico: "text-muted-foreground", word: "Worth knowing" },
} as const;

function Insights({ insights }: { insights: Insight[] }) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <p className="text-sm font-bold">What to do about it</p>
      <p className="text-muted-foreground mt-0.5 text-xs">Worked out from the figures by fixed rules, always up to date.</p>
      <ul className="mt-3 space-y-2">
        {insights.map((i) => {
          const t = TONE[i.tone];
          const Icon = t.icon;
          return (
            <li key={i.key} className={cn("rounded-xl border p-3", t.cls)}>
              <p className="flex items-start gap-2 text-sm font-semibold">
                <Icon className={cn("mt-0.5 size-4 shrink-0", t.ico)} aria-label={t.word} />
                {i.title}
              </p>
              <p className="text-muted-foreground mt-1 pl-6 text-xs leading-relaxed">{i.body}</p>
              {i.href &&
                (i.href.startsWith("#") ? (
                  // A plain anchor: the tabs follow hashchange, which a client-side Link never fires.
                  <a href={i.href} className="text-primary mt-1 inline-block pl-6 text-xs font-medium hover:underline">
                    {i.action ?? "Show me"} →
                  </a>
                ) : (
                  <Link href={i.href} className="text-primary mt-1 inline-block pl-6 text-xs font-medium hover:underline">
                    {i.action ?? "Show me"} →
                  </Link>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GroupTable({ rows, title, note }: { rows: GroupRow[]; title: string; note: string }) {
  return (
    <section className="bg-card rounded-2xl border">
      <div className="p-4">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{note}</p>
      </div>
      <ScrollableTable>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-muted-foreground border-y text-xs">
            <tr>
              <th className="px-4 py-2 text-left font-medium" />
              <th className="px-3 py-2 text-right font-medium">Churches</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-3 py-2 text-right font-medium">Cost to serve</th>
              <th className="px-3 py-2 text-right font-medium">Left over</th>
              <th className="px-3 py-2 text-right font-medium">Per church a month: paid</th>
              <th className="px-4 py-2 text-right font-medium">cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">{g.label}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{g.churches}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(g.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(g.cost)}</td>
                <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", g.margin < 0 ? "text-red-600 dark:text-red-400" : "")}>
                  {formatMoney(g.margin)}
                  {g.marginPct != null && <span className="text-muted-foreground block text-xs font-normal">{g.marginPct}%</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(g.revenuePerChurchMonth)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(g.costPerChurchMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}

function Plans({ report }: { report: CostReport }) {
  return (
    <div className="space-y-6">
      <GroupTable rows={report.plans} title="By plan" note="Each church under the plan it is on today. Per church a month is what to set a price against." />
      <GroupTable rows={report.statuses} title="Paying, on trial, not paying" note="What churches that pay nothing still cost to keep running." />
    </div>
  );
}

function Features({ report }: { report: CostReport }) {
  const max = Math.max(1, ...report.features.map((f) => Math.max(f.cost, f.revenue)));
  return (
    <section className="bg-card rounded-2xl border">
      <div className="p-4">
        <p className="text-sm font-bold">What each part of the platform costs</p>
        <p className="text-muted-foreground mt-0.5 max-w-3xl text-xs">
          Against what it brings in directly. SMS and storage are sold from the wallet; everything else is paid for by the plan, so
          plan revenue sits against running the platform.
        </p>
      </div>
      <ul>
        {report.features.map((f) => (
          <li key={f.bucket} className="grid gap-2 border-t px-4 py-3 sm:grid-cols-[180px_1fr_auto] sm:items-center">
            <p className="text-sm font-medium">{f.label}</p>
            <div className="space-y-1" aria-hidden>
              <div className="bg-primary h-2 rounded-full" style={{ width: `${(f.revenue / max) * 100}%` }} />
              <div className="bg-muted-foreground/50 h-2 rounded-full" style={{ width: `${(f.cost / max) * 100}%` }} />
            </div>
            <p className="text-xs tabular-nums sm:text-right">
              <span className="text-muted-foreground">Brings in</span> {formatMoney(f.revenue)} · <span className="text-muted-foreground">costs</span>{" "}
              {formatMoney(f.cost)}
            </p>
          </li>
        ))}
        <li className="text-muted-foreground border-t px-4 py-3 text-xs">
          Not part of serving: {BUCKET_LABEL.acquisition.toLowerCase()} {formatMoney(report.byBucket.acquisition)}, {BUCKET_LABEL.overhead.toLowerCase()}{" "}
          {formatMoney(report.byBucket.overhead)}. Serving cost no church accounts for: {formatMoney(report.untraced)}.
        </li>
      </ul>
      <p className="sr-only">
        {SERVE_BUCKETS.map((b) => `${BUCKET_LABEL[b]}: costs ${formatMoney(report.byBucket[b])}`).join(". ")}
      </p>
    </section>
  );
}

function Acquisition({ report }: { report: CostReport }) {
  const a = report.acquisitionStats;
  const cells: [string, string, string][] = [
    ["Spent winning churches", formatMoney(a.spend), "Marketing bills, Partner commission and referral credit"],
    ["New paying churches", String(a.newPaying), "First payment in this period"],
    ["Cost to win one", a.cac != null ? formatMoney(a.cac) : "—", "Spend ÷ new paying churches"],
    ["A paying church leaves", a.grossPerPayingMonth != null ? `${formatMoney(a.grossPerPayingMonth)} /mo` : "—", "What it pays less its cost to serve"],
    ["Paid back in", a.paybackMonths != null ? `${Math.round(a.paybackMonths * 10) / 10} months` : "—", "Under 12 is healthy"],
    ["Stop paying each month", a.monthlyChurn != null ? `${Math.round(a.monthlyChurn * 1000) / 10}%` : "—", "Over the last six finished months"],
    ["Worth over its lifetime", a.ltv != null ? formatMoney(a.ltv) : "—", a.monthlyChurn === 0 ? "No paying church has stopped yet" : "Monthly profit ÷ churn"],
    ["Worth ÷ cost to win", a.ltvToCac != null ? `${a.ltvToCac.toFixed(1)}×` : "—", "3× or more is the usual bar"],
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cells.map(([l, v, s]) => (
          <div key={l} className="bg-card rounded-2xl border p-4">
            <p className="text-muted-foreground text-xs font-medium">{l}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{v}</p>
            <p className="text-muted-foreground mt-1 text-xs">{s}</p>
          </div>
        ))}
      </div>
      <section className="bg-card rounded-2xl border">
        <div className="p-4">
          <p className="text-sm font-bold">By channel</p>
          <p className="text-muted-foreground mt-0.5 max-w-3xl text-xs">
            A church&apos;s channel is its Partner, the church that referred it, or the source of its lead in Growth once marked
            converted. Marketing costs count towards the channel typed on them.
          </p>
        </div>
        {a.byChannel.length === 0 ? (
          <p className="text-muted-foreground border-t p-6 text-center text-sm">No spend and no new paying church in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-y text-xs">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Channel</th>
                <th className="px-3 py-2 text-right font-medium">Spent</th>
                <th className="px-3 py-2 text-right font-medium">New paying</th>
                <th className="px-4 py-2 text-right font-medium">Cost each</th>
              </tr>
            </thead>
            <tbody>
              {a.byChannel.map((c) => (
                <tr key={c.channel} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium capitalize">{c.channel === "direct" ? "Unknown source" : c.channel}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(c.spend)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{c.newPaying}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.cac != null ? formatMoney(c.cac) : "—"}</td>
                </tr>
              ))}
              {a.untaggedSpend > 0 && (
                <tr>
                  <td className="text-muted-foreground px-4 py-2.5">Marketing with no channel</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(a.untaggedSpend)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
