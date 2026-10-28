import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActAsChurchId, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/translate";
import {
  CHURCH_AI_NOTES_MAX,
  getAdvisorPilot,
  getAdvisorRollout,
  getAiPlatformState,
  getChurchAiSetting,
} from "@/lib/ai/settings";
import { churchToday } from "@/lib/church-today";
import { getChurchSummaryView, previewChurchPayload } from "@/lib/ai/summaries";
import { hasFeatures } from "@/lib/entitlements-server";
import { planNameFor, type FeatureKey } from "@/lib/entitlements";
import { loadCatalog } from "@/lib/plan-catalog";
import { advisorRolloutAllows } from "@/lib/assistant/advisor-shared";
import { PlanGate } from "@/components/app/plan-gate";
import { AiSettings } from "@/components/settings/ai-settings";
import { AiNotes } from "@/components/settings/ai-notes";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const metadata = { title: "AI features · Settings" };
export const dynamic = "force-dynamic";

type FeatureStatus = "on" | "off" | "needsPlan" | "paused" | "unavailable" | "pilot";

const STATUS_KEY: Record<FeatureStatus, TKey> = {
  on: "ai.statusOn",
  off: "ai.statusOff",
  needsPlan: "ai.statusNeedsPlan",
  paused: "ai.statusPaused",
  unavailable: "ai.statusUnavailable",
  pilot: "ai.statusPilot",
};

const STATUS_TONE: Record<FeatureStatus, string> = {
  on: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  off: "bg-muted text-muted-foreground",
  needsPlan: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  paused: "bg-muted text-muted-foreground",
  unavailable: "bg-muted text-muted-foreground",
  pilot: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

/*
 * The most basic reason first: a feature the plan lacks is "needs the plan"
 * even while AI is paused, because upgrading is the only thing the owner can
 * do about it; consent comes last, because it is the one switch on this page.
 */
function statusOf(s: {
  onPlan: boolean;
  configured: boolean;
  paused: boolean;
  rolloutAllows: boolean;
  enabled: boolean;
}): FeatureStatus {
  if (!s.onPlan) return "needsPlan";
  if (!s.configured) return "unavailable";
  if (s.paused) return "paused";
  if (!s.rolloutAllows) return "pilot";
  return s.enabled ? "on" : "off";
}

/**
 * The church's AI features and its consent to them. Owner-only: the nav
 * hides it from everyone else, and this redirect covers somebody who types
 * the address.
 *
 * One consent covers all three features. Each row below says what that
 * feature needs on top of it (a plan, or the advisor's rollout), so an owner
 * who turned AI on and still sees no advisor answers can read why here.
 */
export default async function AiSettingsPage() {
  const { church } = await requireChurch();
  const t = await getT();
  const access = await getAccess();
  if (!access.isOwner) redirect("/settings");
  const catalog = await loadCatalog();

  const [setting, view, actAs, plans, state, rollout, pilot] = await Promise.all([
    getChurchAiSetting(church.id),
    getChurchSummaryView(church.id),
    getActAsChurchId(),
    hasFeatures("assistant", "aiSummaries", "aiAdvisor"),
    getAiPlatformState(),
    getAdvisorRollout(),
    getAdvisorPilot(),
  ]);
  const a = view.availability;
  const paused = (f: "chat" | "analytics" | "advisor") => state.killed || state.pausedFeatures.includes(f);

  const enabledLine =
    setting.enabled && setting.enabledAt
      ? t("ai.enabledBy", {
          name: setting.changedByName ?? "—",
          // The church's calendar day, not the server's: consent given at 00:30
          // in Lagos is dated that day, not the one before.
          date: new Date(`${churchToday(church.timezone, setting.enabledAt)}T12:00:00Z`).toLocaleDateString(
            t.intl,
            { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
          ),
        })
      : null;

  const rows: { feature: FeatureKey; name: string; body: string; plan: string; status: FeatureStatus }[] = [
    {
      feature: "assistant",
      name: t("ai.featureAssistant"),
      body: t("ai.featureAssistantBody"),
      plan: t("ai.planEvery"),
      status: statusOf({
        onPlan: plans.assistant,
        configured: state.configured,
        paused: paused("chat"),
        rolloutAllows: true,
        enabled: setting.enabled,
      }),
    },
    {
      feature: "aiSummaries",
      name: t("ai.featureSummaries"),
      body: t("ai.featureSummariesBody"),
      plan: t("ai.planFrom", { plan: planNameFor("aiSummaries", catalog) }),
      status: statusOf({
        onPlan: plans.aiSummaries,
        configured: state.configured,
        paused: paused("analytics"),
        rolloutAllows: true,
        enabled: setting.enabled,
      }),
    },
    {
      feature: "aiAdvisor",
      name: t("ai.featureAdvisor"),
      body: t("ai.featureAdvisorBody"),
      plan: t("ai.planFrom", { plan: planNameFor("aiAdvisor", catalog) }),
      status: statusOf({
        onPlan: plans.aiAdvisor,
        configured: state.configured,
        paused: paused("advisor"),
        rolloutAllows: advisorRolloutAllows(rollout, pilot, church.slug),
        enabled: setting.enabled,
      }),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">{t("ai.settingsTitle")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("ai.settingsSubtitle")}</p>
      </div>

      {!a.configured ? (
        <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">{t("ai.allNotConfigured")}</p>
      ) : a.killed ? (
        <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">{t("ai.allPaused")}</p>
      ) : null}

      <PlanGate feature="assistant" />

      <AiSettings
        enabled={setting.enabled}
        enabledLine={enabledLine}
        configured={a.configured}
        isDemo={church.isDemo}
        isActingAs={actAs !== null}
        onPlan={plans.assistant}
        monthCount={view.monthCount}
      />

      <section className="bg-card rounded-2xl border p-4" aria-labelledby="ai-features-heading">
        <h3 id="ai-features-heading" className="font-semibold">
          {t("ai.featuresTitle")}
        </h3>
        <ul className="mt-2 divide-y">
          {rows.map((r) => (
            <li key={r.feature} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {r.name} <span className="text-muted-foreground font-normal">· {r.plan}</span>
                </p>
                <p className="text-muted-foreground mt-0.5 text-sm">{r.body}</p>
              </div>
              <span
                className={cn(
                  "w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                  STATUS_TONE[r.status],
                )}
              >
                {t(STATUS_KEY[r.status], { plan: planNameFor(r.feature, catalog) })}
              </span>
            </li>
          ))}
        </ul>
        {rows.some((r) => r.status === "needsPlan") && (
          <Link
            href="/settings/billing"
            className="text-primary mt-1 inline-flex min-h-11 items-center text-sm font-semibold hover:underline sm:min-h-0"
          >
            {t("ai.seePlans")}
          </Link>
        )}
      </section>

      <AiNotes
        notes={setting.notes ?? ""}
        max={CHURCH_AI_NOTES_MAX}
        locked={church.isDemo || actAs !== null}
        onPlan={plans.aiAdvisor}
        aiOn={setting.enabled}
        planName={planNameFor("aiAdvisor", catalog)}
      />

      <details className="bg-card rounded-2xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">{t("ai.preview")}</summary>
        <div className="mt-3">
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <PayloadPreview churchId={church.id} />
          </Suspense>
        </div>
      </details>
    </div>
  );
}

/** Exactly what would leave today. On a rejection, the path only, never the value. */
async function PayloadPreview({ churchId }: { churchId: string }) {
  const t = await getT();
  const preview = await previewChurchPayload(churchId);
  if (!preview.ok) {
    return <p className="text-destructive text-sm">{t("ai.previewFailed", { path: preview.path })}</p>;
  }
  return (
    // Only this box scrolls sideways, never the page.
    <div className="bg-muted max-h-96 overflow-auto rounded-xl">
      <pre className="p-3 text-xs leading-relaxed">{preview.json}</pre>
    </div>
  );
}
