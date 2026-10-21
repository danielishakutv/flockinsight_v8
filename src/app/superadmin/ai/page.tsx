import { Suspense } from "react";
import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { aiBudgetMonth, aiCall, aiChurchSetting, church, type AiCallStatus, type AiFeature } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { getAiPlatformState } from "@/lib/ai/settings";
import { monthKey } from "@/lib/ai/budget-rules";
import { formatNanoUsd } from "@/lib/ai/pricing";
import { AiControls } from "@/components/superadmin/ai-controls";
import { AiCallsTable, type AiCallRow } from "@/components/superadmin/ai-calls-table";
import { ListCardSkeleton, StatusLineSkeleton } from "@/components/superadmin/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "AI · Admin" };
export const dynamic = "force-dynamic";

const FEATURES: AiFeature[] = ["analytics", "chat", "blog"];
const STATUSES: AiCallStatus[] = ["reserved", "ok", "refused", "truncated", "error", "abandoned"];

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * What the AI features cost, what was sent, and the switch that stops them.
 * English-only, like every superadmin page. Each section streams in its own
 * Suspense so one slow query cannot hold the rest.
 */
export default async function SuperadminAiPage({ searchParams }: { searchParams: Search }) {
  const access = await requirePlatform("platform.ai.view");
  const sp = await searchParams;
  const canManage = access.perms.has("platform.ai.manage");
  const filters = {
    feature: FEATURES.find((f) => f === one(sp.feature)),
    status: STATUSES.find((s) => s === one(sp.status)),
    church: one(sp.church)?.trim() || undefined,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every call to a model, what it sent, what it cost, and the controls that stop it.
        </p>
      </div>

      <Suspense fallback={<StatusLineSkeleton />}>
        <StatusStrip canManage={canManage} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton rows={3} />}>
          <SpendByFeature />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton />}>
          <TopChurches />
        </Suspense>
      </div>

      <Suspense fallback={<ListCardSkeleton rows={6} />}>
        <RecentCalls filters={filters} />
      </Suspense>
    </div>
  );
}

async function StatusStrip({ canManage }: { canManage: boolean }) {
  const month = monthKey();
  const [state, [budget], [optIns], statusRows] = await Promise.all([
    getAiPlatformState(),
    db
      .select({ spent: aiBudgetMonth.spentNano, reserved: aiBudgetMonth.reservedNano })
      .from(aiBudgetMonth)
      .where(and(eq(aiBudgetMonth.month, month), eq(aiBudgetMonth.subject, "platform")))
      .limit(1),
    db
      .select({ n: sql<string>`count(*)` })
      .from(aiChurchSetting)
      .where(eq(aiChurchSetting.enabled, true)),
    db
      .select({ status: aiCall.status, n: sql<string>`count(*)` })
      .from(aiCall)
      .where(eq(aiCall.budgetMonth, month))
      .groupBy(aiCall.status),
  ]);
  const spent = budget?.spent ?? 0;
  const reserved = budget?.reserved ?? 0;
  const ceiling = state.platformCeilingNano;
  const pct = ceiling > 0 ? Math.min(100, ((spent + reserved) / ceiling) * 100) : 100;
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const calls = [...byStatus.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="API key" value={state.configured ? "Set" : "Not set"} tone={state.configured ? "ok" : "muted"} />
        <Tile label="Kill switch" value={state.killed ? "ON: all stopped" : "Off"} tone={state.killed ? "bad" : "ok"} />
        <Tile label="Churches opted in" value={String(Number(optIns?.n ?? 0))} />
        <Tile
          label={`Calls in ${month} (UTC)`}
          value={String(calls)}
          sub={`${byStatus.get("refused") ?? 0} refused · ${byStatus.get("error") ?? 0} errors · ${byStatus.get("abandoned") ?? 0} abandoned`}
        />
      </div>

      <Card>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">
              {formatNanoUsd(spent, 2)} of {formatNanoUsd(ceiling, 2)} this month
            </span>
            <span className="text-muted-foreground">{formatNanoUsd(reserved, 4)} reserved by calls in flight</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full" role="presentation">
            <div
              className={pct >= 90 ? "h-full bg-rose-500" : "bg-primary h-full"}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Each church may spend up to {formatNanoUsd(state.churchShareNano, 2)} a month. Paused features:{" "}
            {state.pausedFeatures.length ? state.pausedFeatures.join(", ") : "none"}.
          </p>
          {!state.configured && (
            <p className="text-muted-foreground text-sm">
              AI is dormant: set ANTHROPIC_API_KEY on the server and restart with --update-env.
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <AiControls
          killed={state.killed}
          platformUsd={state.platformCeilingUsd}
          churchUsd={state.churchShareUsd}
          paused={state.pausedFeatures}
        />
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" | "muted" }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p
        className={
          tone === "bad"
            ? "text-lg font-bold text-rose-600 dark:text-rose-400"
            : tone === "muted"
              ? "text-muted-foreground text-lg font-bold"
              : "text-lg font-bold"
        }
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </Card>
  );
}

async function SpendByFeature() {
  const month = monthKey();
  const rows = await db
    .select({
      feature: aiCall.feature,
      calls: sql<string>`count(*)`,
      cost: sql<string>`coalesce(sum(${aiCall.costNano}), 0)`,
      reserved: sql<string>`coalesce(sum(${aiCall.reservedNano}) filter (where ${aiCall.status} = 'reserved'), 0)`,
    })
    .from(aiCall)
    .where(eq(aiCall.budgetMonth, month))
    .groupBy(aiCall.feature);
  const byFeature = new Map(rows.map((r) => [r.feature, r]));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Spend by feature, {month}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {FEATURES.map((f) => {
          const r = byFeature.get(f);
          return (
            <div key={f} className="flex items-center justify-between py-2 text-sm">
              <span className="capitalize">{f}</span>
              <span className="tabular-nums">
                {formatNanoUsd(Number(r?.cost ?? 0))} · {Number(r?.calls ?? 0)} calls
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

async function TopChurches() {
  const month = monthKey();
  const cost = sql<string>`coalesce(sum(${aiCall.costNano}), 0)`;
  const rows = await db
    .select({ churchId: aiCall.churchId, calls: sql<string>`count(*)`, cost })
    .from(aiCall)
    .where(and(eq(aiCall.budgetMonth, month), isNotNull(aiCall.churchId)))
    .groupBy(aiCall.churchId)
    .orderBy(desc(cost))
    .limit(10);
  const ids = rows.map((r) => r.churchId).filter((id): id is string => !!id);
  // Joined in JS: an ai_call row outlives its church (no foreign key), so a
  // missing name means the church was deleted, not a broken join.
  const names = ids.length
    ? new Map(
        (await db.select({ id: church.id, name: church.name }).from(church).where(inArray(church.id, ids))).map(
          (c) => [c.id, c.name],
        ),
      )
    : new Map<string, string>();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top churches by spend, {month}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No church has used AI this month.</p>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.churchId} className="flex items-center justify-between gap-3 py-2 text-sm">
                {names.has(r.churchId as string) ? (
                  <Link href={`/superadmin/churches/${r.churchId}`} className="min-w-0 truncate hover:underline">
                    {names.get(r.churchId as string)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground min-w-0 truncate">Deleted church</span>
                )}
                <span className="shrink-0 tabular-nums">
                  {formatNanoUsd(Number(r.cost))} · {Number(r.calls)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function RecentCalls({
  filters,
}: {
  filters: { feature?: AiFeature; status?: AiCallStatus; church?: string };
}) {
  const where: SQL[] = [];
  if (filters.feature) where.push(eq(aiCall.feature, filters.feature));
  if (filters.status) where.push(eq(aiCall.status, filters.status));
  if (filters.church) where.push(eq(aiCall.churchId, filters.church));
  const rows = await db
    .select({
      id: aiCall.id,
      createdAt: aiCall.createdAt,
      churchId: aiCall.churchId,
      feature: aiCall.feature,
      model: aiCall.model,
      servedModel: aiCall.servedModel,
      status: aiCall.status,
      inputTokens: aiCall.inputTokens,
      outputTokens: aiCall.outputTokens,
      costNano: aiCall.costNano,
      reservedNano: aiCall.reservedNano,
    })
    .from(aiCall)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(aiCall.createdAt))
    .limit(50);
  const ids = [...new Set(rows.map((r) => r.churchId).filter((id): id is string => !!id))];
  const names = ids.length
    ? new Map(
        (await db.select({ id: church.id, name: church.name }).from(church).where(inArray(church.id, ids))).map(
          (c) => [c.id, c.name],
        ),
      )
    : new Map<string, string>();
  const data: AiCallRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    churchId: r.churchId,
    churchName: r.churchId ? (names.get(r.churchId) ?? null) : null,
    feature: r.feature,
    model: r.model,
    servedModel: r.servedModel,
    status: r.status,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costNano: r.costNano,
    reservedNano: r.reservedNano,
  }));
  const state = await getAiPlatformState();
  return (
    <AiCallsTable
      rows={data}
      filters={filters}
      features={FEATURES}
      statuses={STATUSES}
      dormant={!state.configured}
    />
  );
}
