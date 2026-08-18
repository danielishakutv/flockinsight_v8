import Link from "next/link";
import {
  CalendarClock,
  Flame,
  Mail,
  MessageSquare,
  Target,
  TrendingUp,
} from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/growth-shared";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Churches to onboard this month — the number the whole screen is about. */
const MONTHLY_TARGET = 50;

type Stats = {
  byStatus: Record<LeadStatus, number>;
  total: number;
  open: number;
  dueNow: number;
  convertedThisMonth: number;
  addedThisMonth: number;
  contactedThisWeek: number;
  sources: { source: string; count: number }[];
};

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
}: {
  icon: typeof Target;
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: string;
}) {
  const inner = (
    <CardContent className="flex items-start gap-3 py-4">
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          tone ?? "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          {label}
        </p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      </div>
    </CardContent>
  );
  return href ? (
    <Card className="hover:border-primary/40 transition-colors">
      <Link href={href}>{inner}</Link>
    </Card>
  ) : (
    <Card>{inner}</Card>
  );
}

export function PipelineHeader({
  stats,
  sends,
}: {
  stats: Stats;
  sends: { emails: number; texts: number; campaigns: number };
}) {
  const target = MONTHLY_TARGET;
  const done = stats.convertedThisMonth;
  const pct = Math.min(100, Math.round((done / target) * 100));
  const now = new Date();
  const daysLeft = Math.max(
    0,
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate(),
  );
  // Only stages worth showing as a funnel — "lost" isn't part of the flow.
  const funnel = LEAD_STATUSES.filter((s) => s.id !== "lost");
  const widest = Math.max(1, ...funnel.map((s) => stats.byStatus[s.id]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={CalendarClock}
          label="Follow up now"
          value={stats.dueNow}
          sub={stats.dueNow ? "Due today or overdue" : "Nothing overdue"}
          href="/superadmin/growth?status=due"
          tone={
            stats.dueNow > 0
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          }
        />
        <Stat
          icon={Flame}
          label="Open leads"
          value={stats.open}
          sub={`${stats.addedThisMonth} added this month`}
          href="/superadmin/growth?status=open"
        />
        <Stat
          icon={TrendingUp}
          label="Touched this week"
          value={stats.contactedThisWeek}
          sub="Leads contacted in the last 7 days"
        />
        <Stat
          icon={Mail}
          label="Sent (30 days)"
          value={sends.emails + sends.texts}
          sub={`${sends.emails} emails · ${sends.texts} SMS`}
          href="/superadmin/growth/outreach"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                This month&rsquo;s goal
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {done}
                <span className="text-muted-foreground text-lg font-bold">
                  {" "}
                  / {target} churches
                </span>
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              {daysLeft} day{daysLeft === 1 ? "" : "s"} left ·{" "}
              {done >= target
                ? "target met"
                : `${target - done} to go, about ${Math.ceil((target - done) / Math.max(1, daysLeft))} a day`}
            </p>
          </div>
          <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="grid gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-3">
            {funnel.map((s) => {
              const n = stats.byStatus[s.id];
              return (
                <Link
                  key={s.id}
                  href={`/superadmin/growth?status=${s.id}`}
                  className="hover:bg-accent/40 group rounded-lg px-2 py-1.5 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <span className="tabular-nums text-sm font-bold">{n}</span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className={cn("h-full rounded-full", s.tone.split(" ")[0])}
                      style={{ width: `${Math.round((n / widest) * 100)}%` }}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{s.hint}</p>
                </Link>
              );
            })}
          </div>

          {stats.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-semibold uppercase">
                <MessageSquare className="size-3.5" /> Where they came from
              </span>
              {stats.sources.slice(0, 8).map((s) => (
                <Link
                  key={s.source}
                  href={`/superadmin/growth?status=all&source=${encodeURIComponent(s.source)}`}
                  className="bg-muted hover:bg-accent rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors"
                >
                  {s.source} · {s.count}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
