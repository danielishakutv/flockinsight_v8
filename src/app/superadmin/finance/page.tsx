import { AlertTriangle, Banknote, Clock, Gift, Wallet } from "lucide-react";
import { requireSuperAdmin } from "@/lib/session";
import {
  getFinanceOverview,
  pendingTopups,
  recentWalletMovements,
  revenueByGateway,
} from "@/lib/finance-admin";
import { formatMoney } from "@/lib/money";
import { RecordPayment } from "@/components/superadmin/record-payment";
import { FinanceTabs } from "@/components/superadmin/finance-tabs";
import { RevenueChart } from "@/components/superadmin/revenue-chart";

export const metadata = { title: "Finance · Admin" };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  await requireSuperAdmin();
  const [overview, movements, topups, gateways] = await Promise.all([
    getFinanceOverview(),
    recentWalletMovements(40),
    pendingTopups(),
    revenueByGateway(),
  ]);

  const churchOptions = overview.churches.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Finance</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Money in, money held, and what each church is worth.
          </p>
        </div>
        <RecordPayment churches={churchOptions} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Banknote className="size-4" />}
          label="Collected this month"
          value={formatMoney(overview.collectedThisMonth)}
          sub={`${formatMoney(overview.collectedThisYear)} this year`}
        />
        <Stat
          icon={<Clock className="size-4" />}
          label="Recurring, per month"
          value={formatMoney(overview.mrr)}
          sub="Churches paying today, trials excluded"
        />
        <Stat
          icon={<Wallet className="size-4" />}
          label="Wallet float held"
          value={formatMoney(overview.walletFloat)}
          sub="Topped up, not yet spent — owed in service"
          muted
        />
        <Stat
          icon={<Gift className="size-4" />}
          label="Referral credit paid"
          value={formatMoney(overview.referralPaid)}
          sub={
            overview.referralPending > 0
              ? `${formatMoney(overview.referralPending)} still owed`
              : "Nothing outstanding"
          }
        />
      </div>

      {overview.pendingNow > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            <span className="font-semibold">
              {formatMoney(overview.pendingNow)} sitting as pending.
            </span>{" "}
            A payment stuck on pending is money the gateway never confirmed —
            it is not counted anywhere above. Void it or chase it.
          </p>
        </div>
      )}

      <RevenueChart data={overview.byMonth} />

      <FinanceTabs
        churches={overview.churches.map((c) => ({
          ...c,
          trialEndsAt: c.trialEndsAt?.toISOString() ?? null,
          planRenewsAt: c.planRenewsAt?.toISOString() ?? null,
          referralRewardedAt: c.referralRewardedAt?.toISOString() ?? null,
        }))}
        payments={overview.payments.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          paidAt: p.paidAt?.toISOString() ?? null,
        }))}
        movements={movements.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        }))}
        topups={topups.map((t) => ({
          ...t,
          createdAt: t.createdAt.toISOString(),
        }))}
        gateways={gateways}
        trials={overview.trials}
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  muted?: boolean;
}) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        {icon}
        <span className="min-h-[1rem] text-balance">{label}</span>
      </div>
      <p
        className={`mt-2 text-2xl font-extrabold tracking-tight ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-1 text-xs text-balance">{sub}</p>
    </div>
  );
}
