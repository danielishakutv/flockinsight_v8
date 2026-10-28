import { Suspense } from "react";
import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, like, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  aiBudgetMonth,
  aiCall,
  aiChurchSetting,
  assistantUsage,
  church,
  type AiCallStatus,
  type AiFeature,
} from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import {
  AI_CHURCH_SHARE_MAX_USD,
  getAdvisorPilot,
  getAdvisorRollout,
  getAiPlatformState,
  getAssistantAllowances,
} from "@/lib/ai/settings";
import { ALLOWANCE_MAX, ASSISTANT_ALLOWANCE_DEFAULTS } from "@/lib/ai/settings-rules";
import { WORKSPACE_FIX, isWorkspaceScopeError } from "@/lib/ai/config";
import { monthKey } from "@/lib/ai/budget-rules";
import { formatNanoUsd } from "@/lib/ai/pricing";
import { ASSISTANT_ADMIN_DAILY, PLAN_ORDER, churchRowHasFeature, planRank } from "@/lib/entitlements";
import { loadCatalog } from "@/lib/plan-catalog";
import { planName, type PlanId } from "@/lib/plans";
import { monthlyAllowanceFor, usagePeriods } from "@/lib/assistant/advisor-shared";
import { AiControls } from "@/components/superadmin/ai-controls";
import { AiAllowances } from "@/components/superadmin/ai-allowances";
import { AiAdvisorRollout } from "@/components/superadmin/ai-advisor-rollout";
import type { PilotChurch } from "@/app/superadmin/ai/actions";
import { AiCallsTable, type AiCallRow } from "@/components/superadmin/ai-calls-table";
import { ListCardSkeleton, StatusLineSkeleton } from "@/components/superadmin/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollableTable } from "@/components/ui/scrollable-table";

export const metadata = { title: "AI · Admin" };
export const dynamic = "force-dynamic";

const FEATURES: AiFeature[] = ["analytics", "chat", "blog", "advisor"];
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

      <Suspense fallback={<ListCardSkeleton rows={4} />}>
        <AssistantSection canManage={canManage} />
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

const PLAN_LABEL: Record<PlanId, string> = {
  starter: planName("starter"),
  growth: planName("growth"),
  pro: planName("pro"),
  enterprise: planName("enterprise"),
};

async function StatusStrip({ canManage }: { canManage: boolean }) {
  const month = monthKey();
  const [state, [budget], [optIns], statusRows, [lastError], [lastOk]] = await Promise.all([
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
    db
      .select({ id: aiCall.id, error: aiCall.error, createdAt: aiCall.createdAt })
      .from(aiCall)
      .where(eq(aiCall.status, "error"))
      .orderBy(desc(aiCall.createdAt))
      .limit(1),
    db
      .select({ createdAt: aiCall.createdAt })
      .from(aiCall)
      .where(eq(aiCall.status, "ok"))
      .orderBy(desc(aiCall.createdAt))
      .limit(1),
  ]);
  const spent = budget?.spent ?? 0;
  const reserved = budget?.reserved ?? 0;
  const ceiling = state.platformCeilingNano;
  const pct = ceiling > 0 ? Math.min(100, ((spent + reserved) / ceiling) * 100) : 100;
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const calls = [...byStatus.values()].reduce((a, b) => a + b, 0);

  // What this process was started with, which is what the AI client reads
  // (once, when it is first created). Only whether it is set: like the key,
  // the value itself is never rendered.
  const workspaceSet = Boolean(process.env.ANTHROPIC_WORKSPACE_ID?.trim());
  // The latest failure says "organisation key" and nothing has succeeded
  // since. A success after it means the fix already landed, and a banner
  // still shouting about it would send someone to fix what is not broken.
  // The raw provider text is tested, so rows stored before the "workspace"
  // classification existed ("bad_request: …") are recognised too.
  const workspaceProblem =
    lastError && isWorkspaceScopeError(lastError.error ?? "") && (!lastOk || lastOk.createdAt < lastError.createdAt)
      ? lastError
      : null;

  return (
    <div className="space-y-4">
      {workspaceProblem && (
        <div
          className="space-y-1 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-900 dark:text-rose-100"
          role="alert"
        >
          <p className="font-semibold">Anthropic is refusing the AI key: it is not scoped to a workspace.</p>
          <p>{WORKSPACE_FIX}</p>
          <p className="text-xs">
            Last seen {workspaceProblem.createdAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC, with no
            successful call since.{" "}
            <Link href={`/superadmin/ai/calls/${workspaceProblem.id}`} className="font-semibold underline">
              Open that call
            </Link>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="API key" value={state.configured ? "Set" : "Not set"} tone={state.configured ? "ok" : "muted"} />
        <Tile
          label="Workspace id"
          value={workspaceSet ? "Set" : "Not set"}
          tone={workspaceSet ? "ok" : "muted"}
          sub={
            workspaceSet
              ? "Sent as anthropic-workspace-id on every call"
              : "Needed only for an organisation-level key"
          }
        />
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
            Each church may spend, by its plan:{" "}
            {PLAN_ORDER.map((p) => `${PLAN_LABEL[p]} $${state.churchShareByPlanUsd[p].toFixed(2)}`).join(" · ")} a
            month. Paused features: {state.pausedFeatures.length ? state.pausedFeatures.join(", ") : "none"}.
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
          churchShareByPlan={state.churchShareByPlanUsd}
          maxChurchShareUsd={AI_CHURCH_SHARE_MAX_USD}
          paused={state.pausedFeatures}
        />
      )}
    </div>
  );
}

const ROLLOUT_TEXT = {
  off: "Off: every question is answered from the guides",
  pilot: "Pilot churches only",
  all: "Every eligible church",
} as const;

/**
 * The assistant's allowances and the church advisor's rollout, with this
 * month's questions by plan beside them: an allowance is only worth editing
 * against what churches actually ask, and "at the limit" is the number that
 * says a plan's allowance is too small (or doing its job).
 */
async function AssistantSection({ canManage }: { canManage: boolean }) {
  const { month } = usagePeriods();
  const [allowances, rollout, pilotSlugs, usageRows] = await Promise.all([
    getAssistantAllowances(),
    getAdvisorRollout(),
    getAdvisorPilot(),
    db
      .select({ subject: assistantUsage.subject, used: assistantUsage.used })
      .from(assistantUsage)
      .where(and(eq(assistantUsage.period, month), like(assistantUsage.subject, "church:%"))),
  ]);

  const usageIds = usageRows.map((r) => r.subject.slice("church:".length));
  const [pilotRows, usagePlans] = await Promise.all([
    pilotSlugs.length
      ? db
          .select({
            slug: church.slug,
            name: church.name,
            plan: church.plan,
            customPlanId: church.customPlanId,
            isDemo: church.isDemo,
            aiOn: aiChurchSetting.enabled,
          })
          .from(church)
          .leftJoin(aiChurchSetting, eq(aiChurchSetting.churchId, church.id))
          .where(inArray(church.slug, pilotSlugs))
      : Promise.resolve([]),
    usageIds.length
      ? db.select({ id: church.id, plan: church.plan }).from(church).where(inArray(church.id, usageIds))
      : Promise.resolve([]),
  ]);

  // In the order they were added; a slug no church has any more stays visible
  // so it can be removed, rather than silently dropping out of the list.
  const bySlug = new Map(pilotRows.map((r) => [r.slug, r]));
  const catalog = await loadCatalog();
  const pilot: PilotChurch[] = pilotSlugs.map((slug) => {
    const r = bySlug.get(slug);
    if (!r) return { slug, name: null, plan: null, aiOn: false, advisorOnPlan: false, isDemo: false };
    return {
      slug,
      name: r.name,
      plan: r.plan,
      aiOn: r.aiOn === true,
      advisorOnPlan: !r.isDemo && churchRowHasFeature(r, "aiAdvisor", catalog),
      isDemo: r.isDemo,
    };
  });

  // This month's questions by plan. A church's counter row outlives a plan
  // change, so it is read against the plan the church is on now, which is
  // also the allowance its next question is checked against.
  const planOf = new Map(usagePlans.map((c) => [c.id, c.plan]));
  const byPlan = new Map<PlanId, { churches: number; questions: number; atLimit: number }>(
    PLAN_ORDER.map((p) => [p, { churches: 0, questions: 0, atLimit: 0 }]),
  );
  for (const r of usageRows) {
    const id = r.subject.slice("church:".length);
    if (!planOf.has(id)) continue; // a deleted church
    const plan = PLAN_ORDER[planRank(planOf.get(id))];
    const limit = monthlyAllowanceFor(plan, allowances);
    const row = byPlan.get(plan)!;
    if (r.used > 0) row.churches += 1;
    row.questions += r.used;
    if (limit !== null && r.used >= limit) row.atLimit += 1;
  }
  const totalQuestions = [...byPlan.values()].reduce((a, b) => a + b.questions, 0);
  const totalChurches = [...byPlan.values()].reduce((a, b) => a + b.churches, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assistant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="font-semibold">Church advisor:</span> {ROLLOUT_TEXT[rollout]}
            {rollout === "pilot" && ` (${pilot.length} church${pilot.length === 1 ? "" : "es"})`}.{" "}
            <span className="text-muted-foreground">
              {totalQuestions.toLocaleString("en")} question{totalQuestions === 1 ? "" : "s"} from{" "}
              {totalChurches.toLocaleString("en")} church{totalChurches === 1 ? "" : "es"} in {month} (UTC). Questions
              asked while acting as a church are on the platform&apos;s count, not these.
            </span>
          </p>
          <ScrollableTable label="Assistant questions this month by plan" hint="Scroll for more">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="px-3 py-2 text-right font-medium">Allowance a month</th>
                  <th className="px-3 py-2 text-right font-medium">Churches asking</th>
                  <th className="px-3 py-2 text-right font-medium">Questions</th>
                  <th className="py-2 pl-3 text-right font-medium">At the limit</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PLAN_ORDER.map((p) => {
                  const r = byPlan.get(p)!;
                  const limit = allowances[p];
                  return (
                    <tr key={p}>
                      <td className="py-2 pr-3">{PLAN_LABEL[p]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {limit === null ? "No limit" : limit.toLocaleString("en")}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.churches.toLocaleString("en")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.questions.toLocaleString("en")}</td>
                      <td
                        className={
                          r.atLimit > 0
                            ? "py-2 pl-3 text-right font-semibold text-amber-700 tabular-nums dark:text-amber-300"
                            : "py-2 pl-3 text-right tabular-nums"
                        }
                      >
                        {r.atLimit.toLocaleString("en")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
          <p className="text-muted-foreground text-xs">
            Each person may ask {allowances.perPersonDaily.toLocaleString("en")} a day; a superadmin{" "}
            {ASSISTANT_ADMIN_DAILY}. Months and days reset in UTC.
            {!canManage && " Changing these needs the Control AI permission."}
          </p>
          {!canManage && rollout === "pilot" && (
            <p className="text-muted-foreground text-xs">
              Pilot churches: {pilot.length ? pilot.map((c) => c.name ?? c.slug).join(", ") : "none"}.
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AiAllowances
            allowances={allowances}
            defaults={ASSISTANT_ALLOWANCE_DEFAULTS}
            adminDaily={ASSISTANT_ADMIN_DAILY}
            max={ALLOWANCE_MAX}
          />
          <AiAdvisorRollout rollout={rollout} pilot={pilot} />
        </div>
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
