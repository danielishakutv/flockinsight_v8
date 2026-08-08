import { Suspense } from "react";
import { desc, eq, sql } from "drizzle-orm";
import { formatDistanceToNowStrict } from "date-fns";
import { Database, HardDrive } from "lucide-react";
import { db } from "@/db";
import { church, termiiSnapshot } from "@/db/schema";
import { getFloatOverview } from "@/lib/float";
import { getCronLiveness } from "@/lib/cron-run";
import { getCohortRetention } from "@/lib/platform-stats";
import { isEmailConfigured } from "@/lib/mailer";
import { isPushConfigured } from "@/lib/push";
import { isPaystackConfigured } from "@/lib/paystack";
import { isTermiiConfigured } from "@/lib/termii-balance";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { listBackups, formatBytes } from "@/lib/backups";
import { FloatPanel, type FloatView } from "@/components/superadmin/float-panel";
import {
  CronTable,
  IntegrationTable,
  type IntegrationStatus,
} from "@/components/superadmin/cron-table";
import {
  FloatPanelSkeleton,
  ListCardSkeleton,
} from "@/components/superadmin/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { refreshFloat, saveUnitCost } from "./actions";

export const metadata = { title: "Health · Admin" };
export const dynamic = "force-dynamic";

export default function SuperadminHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Platform health
        </h1>
        <p className="text-muted-foreground mt-1">
          The float, the scheduled jobs, and whether every integration actually
          works.
        </p>
      </div>

      <Suspense fallback={<FloatPanelSkeleton />}>
        <Float />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton rows={9} />}>
          <Crons />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton rows={5} />}>
          <Integrations />
        </Suspense>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton rows={4} />}>
          <DataAndBackups />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton rows={6} />}>
          <Cohorts />
        </Suspense>
      </div>
    </div>
  );
}

async function Float() {
  const f = await getFloatOverview();
  const view: FloatView = {
    ...f,
    fetchedAt: f.fetchedAt ? f.fetchedAt.toISOString() : null,
    history: f.history.map((h) => ({
      fetchedAt: h.fetchedAt.toISOString(),
      balance: h.balance,
    })),
  };
  return (
    <FloatPanel float={view} refresh={refreshFloat} saveUnitCost={saveUnitCost} />
  );
}

async function Crons() {
  return <CronTable jobs={await getCronLiveness()} />;
}

async function Integrations() {
  const [lastTermii] = await db
    .select()
    .from(termiiSnapshot)
    .orderBy(desc(termiiSnapshot.fetchedAt))
    .limit(1);

  const items: IntegrationStatus[] = [
    {
      label: "Termii (SMS)",
      configured: isTermiiConfigured(),
      lastResult: lastTermii
        ? {
            ok: lastTermii.ok,
            at: lastTermii.fetchedAt,
            error: lastTermii.error,
          }
        : null,
    },
    {
      label: "Resend (email)",
      configured: isEmailConfigured(),
      note: "Configured — failures show in server logs",
    },
    { label: "Paystack (payments)", configured: isPaystackConfigured() },
    { label: "Cloudinary (media)", configured: isCloudinaryConfigured() },
    { label: "Web push (VAPID)", configured: isPushConfigured() },
  ];

  return <IntegrationTable items={items} />;
}

async function DataAndBackups() {
  const [sizeRow, counts, backups] = await Promise.all([
    db.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as size`),
    db.execute(sql`
      select
        (select count(*) from church) as churches,
        (select count(*) from member) as members,
        (select count(*) from analytics_event) as events
    `),
    listBackups().catch(() => []),
  ]);

  const size = (sizeRow.rows[0] as { size?: string } | undefined)?.size ?? "—";
  const c = (counts.rows[0] ?? {}) as {
    churches?: string;
    members?: string;
    events?: string;
  };
  const newest = backups.length > 0 ? Math.max(...backups.map((b) => b.mtime)) : null;

  const storage = await db
    .select({
      sold: sql<number>`coalesce(sum(${church.storageExtraBytes}), 0)`,
    })
    .from(church);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="text-primary size-5" />
          Data &amp; backups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row label="Database size" value={size} />
        <Row label="Churches" value={Number(c.churches ?? 0).toLocaleString()} />
        <Row label="Members" value={Number(c.members ?? 0).toLocaleString()} />
        <Row
          label="Analytics events"
          value={Number(c.events ?? 0).toLocaleString()}
        />
        <Row
          label="Extra storage sold"
          value={formatBytes(Number(storage[0]?.sold ?? 0))}
        />
        <Row
          label="Backups on disk"
          value={backups.length === 0 ? "None" : String(backups.length)}
        />
        <Row
          label="Newest backup"
          value={
            newest
              ? formatDistanceToNowStrict(new Date(newest), { addSuffix: true })
              : "None found"
          }
          tone={
            newest === null || Date.now() - newest > 48 * 3_600_000
              ? "bad"
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          tone === "bad"
            ? "text-destructive font-bold tabular-nums"
            : "font-bold tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

async function Cohorts() {
  const rows = await getCohortRetention();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HardDrive className="text-primary size-5" />
          Cohort retention
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No signups in the last 12 months yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="pb-2 font-bold">Signed up</th>
                  <th className="pb-2 text-right font-bold">Churches</th>
                  <th className="pb-2 text-right font-bold">Wk 4</th>
                  <th className="pb-2 text-right font-bold">Wk 8</th>
                  <th className="pb-2 text-right font-bold">Wk 12</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} className="border-t">
                    <td className="py-2 font-medium">{r.month}</td>
                    <td className="py-2 text-right tabular-nums">{r.signups}</td>
                    <Pct value={r.week4} />
                    <Pct value={r.week8} />
                    <Pct value={r.week12} />
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-3 text-xs">
              Share of each month&apos;s signups still active at that week. A dash
              means the cohort is too young to tell.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Pct({ value }: { value: number | null }) {
  return (
    <td className="py-2 text-right tabular-nums">
      {value === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span
          className={
            value >= 50
              ? "text-success font-bold"
              : value >= 25
                ? "font-bold text-amber-600 dark:text-amber-400"
                : "text-destructive font-bold"
          }
        >
          {value}%
        </span>
      )}
    </td>
  );
}
