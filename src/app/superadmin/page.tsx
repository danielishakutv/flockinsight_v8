import { Suspense } from "react";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { format } from "date-fns";
import {
  Activity,
  AlertTriangle,
  Banknote,
  CreditCard,
  HandCoins,
  LogIn,
  MessageSquare,
  TrendingDown,
} from "lucide-react";
import { db } from "@/db";
import { church, payment, walletTopup } from "@/db/schema";
import { getOpenAlerts } from "@/lib/platform-alerts";
import { getChurchesNeedingAttention } from "@/lib/platform-health";
import { getOverviewStats, getGrowthSeries } from "@/lib/platform-stats";
import { getFloatOverview } from "@/lib/float";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { StatCard } from "@/components/app/stat-card";
import {
  ActionQueue,
  StatusLine,
  type QueueItem,
} from "@/components/superadmin/action-queue";
import { GrowthChart } from "@/components/superadmin/growth-chart";
import { HealthBadge, LastSeen } from "@/components/superadmin/health-badge";
import {
  ChartSkeleton,
  ListCardSkeleton,
  QueueSkeleton,
  StatGridSkeleton,
  StatusLineSkeleton,
} from "@/components/superadmin/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Overview · Admin" };
export const dynamic = "force-dynamic";

/**
 * The command centre. Ordered so "is anything wrong?" is answered above the
 * fold, on a phone, before any growth number. Each section streams in its own
 * Suspense boundary so a slow query cannot hold the page hostage.
 */
export default function SuperadminOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Command centre
        </h1>
        <p className="text-muted-foreground mt-1">
          Everything happening across FlockInsight, and anything that needs you.
        </p>
      </div>

      <Suspense fallback={<StatusLineSkeleton />}>
        <StatusSection />
      </Suspense>

      <Suspense fallback={<QueueSkeleton />}>
        <QueueSection />
      </Suspense>

      <Suspense fallback={<StatGridSkeleton />}>
        <KeyNumbers />
      </Suspense>

      <Suspense fallback={<ChartSkeleton />}>
        <Growth />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton />}>
          <NeedsAHuman />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton />}>
          <RecentMoney />
        </Suspense>
      </div>
    </div>
  );
}

/** Alerts plus live queue counts, as one ranked list. */
async function buildQueue(): Promise<QueueItem[]> {
  const alerts = await getOpenAlerts();
  return alerts.map((a) => ({
    key: a.key,
    severity: a.severity,
    message: a.message,
    href: hrefForAlert(a.key),
  }));
}

function hrefForAlert(key: string): string {
  if (key.startsWith("float.") || key.startsWith("cron.")) {
    return "/superadmin/health";
  }
  if (key.startsWith("backup.")) return "/superadmin/backups";
  if (key.startsWith("support.")) return "/superadmin/support";
  if (key.startsWith("sms.")) return "/superadmin/sms";
  return "/superadmin/health";
}

async function StatusSection() {
  return <StatusLine items={await buildQueue()} />;
}

async function QueueSection() {
  return <ActionQueue items={await buildQueue()} />;
}

async function KeyNumbers() {
  const [stats, float] = await Promise.all([
    getOverviewStats(),
    getFloatOverview(),
  ]);

  // A runway in days is abstract; a date is not. Show when it actually runs dry.
  const dryDate =
    float.runwayDays !== null
      ? format(
          new Date(Date.now() + float.runwayDays * 86_400_000),
          "EEE d MMM",
        )
      : null;

  const runwayValue =
    float.runwayDays === null
      ? float.configured
        ? "—"
        : "Not set up"
      : `${Math.round(float.runwayDays)}d`;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
      <StatCard
        label="MRR"
        value={formatMoneyCompact(stats.mrr.value, "NGN")}
        sub="Active plans"
        icon={CreditCard}
        accent
      />
      <StatCard
        label="Revenue this month"
        value={formatMoneyCompact(stats.revenueMonth.value, "NGN")}
        sub={format(new Date(), "MMMM yyyy")}
        icon={Banknote}
        delta={stats.revenueMonth.delta}
      />
      <StatCard
        label="Active churches"
        value={`${stats.activeChurches}/${stats.totalChurches}`}
        sub="Used the app in 7 days"
        icon={Activity}
      />
      <StatCard
        label="Termii runway"
        value={runwayValue}
        sub={
          dryDate
            ? `Runs dry ${dryDate}`
            : float.configured
              ? "Needs a few readings"
              : "Add TERMII_API_KEY"
        }
        icon={MessageSquare}
      />
      <StatCard
        label="SMS margin"
        value={
          stats.marginMonth === null
            ? "Set unit cost"
            : formatMoneyCompact(stats.marginMonth, "NGN")
        }
        sub={stats.marginMonth === null ? "On Health page" : "This month"}
        icon={HandCoins}
      />
      <StatCard
        label="Revenue at risk"
        value={formatMoneyCompact(stats.revenueAtRisk, "NGN")}
        sub={`${stats.atRisk} at risk · ${stats.neverActivated} never started`}
        icon={TrendingDown}
      />
    </div>
  );
}

async function Growth() {
  const data = await getGrowthSeries(90);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Last 90 days</CardTitle>
      </CardHeader>
      <CardContent>
        <GrowthChart data={data} />
      </CardContent>
    </Card>
  );
}

async function NeedsAHuman() {
  const rows = await getChurchesNeedingAttention(6);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="size-5 text-amber-500" />
          Needs a human
        </CardTitle>
        <Link
          href="/superadmin/churches"
          className="text-primary text-sm font-semibold hover:underline"
        >
          All churches
        </Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No church is at risk or stalled. Everyone who signed up is using it.
          </p>
        ) : (
          rows.map((c) => (
            <Link
              key={c.churchId}
              href={`/superadmin/churches/${c.churchId}`}
              className="hover:bg-accent flex items-center gap-3 rounded-xl px-2 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  <LastSeen at={c.lastSeenAt} /> · {c.memberCount} members
                </p>
              </div>
              <HealthBadge health={c.health} />
              <LogIn className="text-muted-foreground size-4 shrink-0" />
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

type MoneyRow = {
  id: string;
  churchName: string;
  amount: number;
  currency: string;
  kind: string;
  createdAt: Date;
};

async function RecentMoney() {
  const [payments, topups] = await Promise.all([
    db
      .select({
        id: payment.id,
        churchName: church.name,
        amount: payment.amount,
        currency: payment.currency,
        plan: payment.plan,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .innerJoin(church, eq(church.id, payment.churchId))
      .where(eq(payment.status, "success"))
      .orderBy(desc(payment.createdAt))
      .limit(6),
    db
      .select({
        id: walletTopup.id,
        churchName: church.name,
        amount: walletTopup.amount,
        currency: church.currency,
        createdAt: walletTopup.createdAt,
      })
      .from(walletTopup)
      .innerJoin(church, eq(church.id, walletTopup.churchId))
      .where(eq(walletTopup.status, "success"))
      .orderBy(desc(walletTopup.createdAt))
      .limit(6),
  ]);

  const rows: MoneyRow[] = [
    ...payments.map((p) => ({
      id: `p-${p.id}`,
      churchName: p.churchName,
      amount: Number(p.amount),
      currency: p.currency,
      kind: `${p.plan} plan`,
      createdAt: p.createdAt,
    })),
    ...topups.map((t) => ({
      id: `t-${t.id}`,
      churchName: t.churchName,
      amount: Number(t.amount),
      currency: t.currency,
      kind: "Wallet top-up",
      createdAt: t.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 7);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Banknote className="text-primary size-5" />
          Recent money
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No payments or wallet top-ups yet.
          </p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.churchName}</p>
                <p className="text-muted-foreground truncate text-xs capitalize">
                  {r.kind} · {format(r.createdAt, "d MMM yyyy")}
                </p>
              </div>
              <span className="font-bold tabular-nums">
                {formatMoney(r.amount, r.currency)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
