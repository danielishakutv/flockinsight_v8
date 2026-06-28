import Link from "next/link";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { format } from "date-fns";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bell,
  Building2,
  CheckCircle2,
  CreditCard,
  Image as ImageIcon,
  LifeBuoy,
  Mail,
  MessageSquare,
  PauseCircle,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/db";
import {
  church,
  member,
  staff,
  user,
  payment,
  supportTicket,
  attendanceSession,
} from "@/db/schema";
import { metricTotal, topChurchesByMetric } from "@/lib/usage";
import { getPlanPrices } from "@/lib/pricing";
import { PLANS, planName } from "@/lib/plans";
import { formatMoney } from "@/lib/money";
import { isEmailConfigured } from "@/lib/mailer";
import { isSmsConfigured } from "@/lib/sms";
import { isPushConfigured } from "@/lib/push";
import { isPaystackConfigured } from "@/lib/paystack";
import { StatCard } from "@/components/app/stat-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Overview · Admin" };

const QUICK_ACTIONS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Churches", href: "/superadmin/churches", icon: Building2 },
  { label: "Users", href: "/superadmin/users", icon: Users },
  { label: "Pricing", href: "/superadmin/pricing", icon: Tag },
  { label: "Notify", href: "/superadmin/notifications", icon: Bell },
  { label: "Support", href: "/superadmin/support", icon: LifeBuoy },
  { label: "Banners", href: "/superadmin/banners", icon: ImageIcon },
];

export default async function SuperadminOverviewPage() {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const startOfMonthTs = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    [{ churches }],
    [{ suspended }],
    [{ users }],
    [{ members }],
    [{ staffCount }],
    [{ sessions }],
    [{ newThisMonth }],
    [{ revenueTotal }],
    [{ revenueMonth }],
    [{ pendingSenders }],
    [{ openTickets }],
    planRows,
    recent,
    largest,
    recentPayments,
  ] = await Promise.all([
    db.select({ churches: count() }).from(church),
    db.select({ suspended: count() }).from(church).where(eq(church.status, "suspended")),
    db.select({ users: count() }).from(user),
    db.select({ members: count() }).from(member),
    db.select({ staffCount: count() }).from(staff),
    db.select({ sessions: count() }).from(attendanceSession),
    db.select({ newThisMonth: count() }).from(church).where(gte(church.createdAt, startOfMonthTs)),
    db
      .select({ revenueTotal: sql<number>`coalesce(sum(${payment.amount}), 0)` })
      .from(payment)
      .where(eq(payment.status, "success")),
    db
      .select({ revenueMonth: sql<number>`coalesce(sum(${payment.amount}), 0)` })
      .from(payment)
      .where(and(eq(payment.status, "success"), gte(payment.createdAt, startOfMonthTs))),
    db.select({ pendingSenders: count() }).from(church).where(eq(church.smsSenderStatus, "pending")),
    db.select({ openTickets: count() }).from(supportTicket).where(eq(supportTicket.status, "open")),
    db
      .select({ plan: church.plan, total: count() })
      .from(church)
      .where(eq(church.status, "active"))
      .groupBy(church.plan),
    db
      .select({
        id: church.id,
        name: church.name,
        slug: church.slug,
        status: church.status,
        createdAt: church.createdAt,
      })
      .from(church)
      .orderBy(desc(church.createdAt))
      .limit(6),
    db
      .select({
        id: church.id,
        name: church.name,
        status: church.status,
        members: count(member.id),
      })
      .from(church)
      .leftJoin(member, eq(member.churchId, church.id))
      .groupBy(church.id)
      .orderBy(desc(count(member.id)))
      .limit(6),
    db
      .select({
        id: payment.id,
        churchName: church.name,
        plan: payment.plan,
        amount: payment.amount,
        currency: payment.currency,
        gateway: payment.gateway,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .innerJoin(church, eq(church.id, payment.churchId))
      .where(eq(payment.status, "success"))
      .orderBy(desc(payment.createdAt))
      .limit(6),
  ]);

  const active = Number(churches) - Number(suspended);
  const prices = await getPlanPrices();
  const planMap = new Map(planRows.map((r) => [r.plan, Number(r.total)]));
  const mrr = (["growth", "pro"] as const).reduce(
    (sum, p) => sum + (prices[p] ?? 0) * (planMap.get(p) ?? 0),
    0,
  );

  const attention = [
    Number(pendingSenders) > 0 && {
      label: `${pendingSenders} sender ID${Number(pendingSenders) === 1 ? "" : "s"} to review`,
      href: "/superadmin/sms",
      icon: BadgeCheck,
    },
    Number(openTickets) > 0 && {
      label: `${openTickets} support ticket${Number(openTickets) === 1 ? "" : "s"} need a reply`,
      href: "/superadmin/support",
      icon: LifeBuoy,
    },
    Number(suspended) > 0 && {
      label: `${suspended} suspended church${Number(suspended) === 1 ? "" : "es"}`,
      href: "/superadmin/churches",
      icon: PauseCircle,
    },
  ].filter(Boolean) as { label: string; href: string; icon: LucideIcon }[];

  const systemStatus = [
    { label: "Email", ok: isEmailConfigured() },
    { label: "SMS (Termii)", ok: isSmsConfigured() },
    { label: "Web push", ok: isPushConfigured() },
    { label: "Payments", ok: isPaystackConfigured() },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Platform overview
        </h1>
        <p className="text-muted-foreground mt-1">
          Health and growth across every church on FlockInsight.
        </p>
      </div>

      {/* Needs attention */}
      {attention.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="group flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 transition hover:bg-amber-500/15"
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                <a.icon className="size-5" />
              </div>
              <span className="min-w-0 flex-1 text-sm font-semibold">{a.label}</span>
              <ArrowRight className="text-muted-foreground size-4 shrink-0 transition group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Churches" value={churches} icon={Building2} accent />
        <StatCard label="New this month" value={newThisMonth} icon={Sparkles} />
        <StatCard label="Active" value={active} icon={Activity} />
        <StatCard label="Suspended" value={suspended} icon={PauseCircle} />
        <StatCard
          label="Revenue"
          value={formatMoney(Number(revenueTotal), "NGN")}
          sub="All time"
          icon={Banknote}
        />
        <StatCard
          label="This month"
          value={formatMoney(Number(revenueMonth), "NGN")}
          sub={format(now, "MMMM yyyy")}
          icon={TrendingUp}
        />
        <StatCard
          label="MRR"
          value={formatMoney(mrr, "NGN")}
          sub="Active paid plans"
          icon={CreditCard}
        />
        <StatCard label="Members" value={members} icon={Users} />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="bg-card hover:border-primary/40 hover:bg-accent flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition"
          >
            <a.icon className="text-primary size-5" />
            <span className="text-xs font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Plan mix + system status */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Plan distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {PLANS.map((p) => {
              const n = planMap.get(p.id) ?? 0;
              const pct = active > 0 ? Math.round((n / active) * 100) : 0;
              return (
                <div key={p.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {n} · {pct}%
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-muted-foreground pt-1 text-xs">
              {active} active church{active === 1 ? "" : "es"}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">System status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {systemStatus.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{s.label}</span>
                {s.ok ? (
                  <span className="text-success inline-flex items-center gap-1 text-xs font-bold">
                    <CheckCircle2 className="size-4" /> Configured
                  </span>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-bold">
                    <XCircle className="size-4" /> Not set
                  </span>
                )}
              </div>
            ))}
            <p className="text-muted-foreground pt-1 text-xs">
              {staffCount} team members · {sessions} services recorded.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Messaging activity */}
      <MessagingStats startOfMonth={startOfMonth} />

      {/* Largest + newest churches */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Largest churches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {largest.length === 0 ? (
              <p className="text-muted-foreground text-sm">No churches yet.</p>
            ) : (
              largest.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/superadmin/churches/${c.id}`}
                  className="hover:bg-accent flex items-center gap-3 rounded-xl px-2 py-2"
                >
                  <span className="text-muted-foreground w-5 text-sm font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {c.name}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {Number(c.members)}
                  </span>
                  <span className="text-muted-foreground text-xs">members</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-lg">Newest churches</CardTitle>
            <Link
              href="/superadmin/churches"
              className="text-primary text-sm font-semibold hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.length === 0 ? (
              <p className="text-muted-foreground text-sm">No churches yet.</p>
            ) : (
              recent.map((c) => (
                <Link
                  key={c.id}
                  href={`/superadmin/churches/${c.id}`}
                  className="hover:bg-accent flex items-center justify-between gap-3 rounded-xl px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      /{c.slug} · joined {format(c.createdAt, "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge
                    variant={c.status === "suspended" ? "destructive" : "success"}
                    className="capitalize"
                  >
                    {c.status}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent payments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentPayments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payments yet.</p>
          ) : (
            recentPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.churchName}</p>
                  <p className="text-muted-foreground text-xs capitalize">
                    {planName(p.plan)} · {p.gateway} ·{" "}
                    {format(p.createdAt, "MMM d, yyyy")}
                  </p>
                </div>
                <span className="font-bold tabular-nums">
                  {formatMoney(Number(p.amount), p.currency)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function MessagingStats({ startOfMonth }: { startOfMonth: string }) {
  const [emailTotal, emailMonth, smsTotal, smsMonth, topEmail, topSms] =
    await Promise.all([
      metricTotal("email"),
      metricTotal("email", startOfMonth),
      metricTotal("sms"),
      metricTotal("sms", startOfMonth),
      topChurchesByMetric("email", 5),
      topChurchesByMetric("sms", 5),
    ]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Messaging activity</h2>
      <div className="grid grid-cols-2 gap-3 lg:gap-4">
        <StatCard
          label="Emails sent"
          value={emailTotal.toLocaleString()}
          sub={`${emailMonth.toLocaleString()} this month`}
          icon={Mail}
          accent
        />
        <StatCard
          label="SMS sent"
          value={smsTotal.toLocaleString()}
          sub={`${smsMonth.toLocaleString()} this month`}
          icon={MessageSquare}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TopUsageList title="Top churches — Email" icon={Mail} rows={topEmail} />
        <TopUsageList title="Top churches — SMS" icon={MessageSquare} rows={topSms} />
      </div>
    </div>
  );
}

function TopUsageList({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: LucideIcon;
  rows: { name: string; total: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="text-primary size-5" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No activity yet.</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{r.name}</span>
              <span className="font-bold tabular-nums">{r.total.toLocaleString()}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
