import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActAsChurchId, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server";
import { getChurchAiSetting } from "@/lib/ai/settings";
import { churchToday } from "@/lib/church-today";
import { getChurchSummaryView, previewChurchPayload } from "@/lib/ai/summaries";
import { PlanGate } from "@/components/app/plan-gate";
import { AiSettings } from "@/components/settings/ai-settings";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "AI summaries · Settings" };
export const dynamic = "force-dynamic";

/**
 * The church's consent to AI summaries. Owner-only: the nav hides it from
 * everyone else, and this redirect covers somebody who types the address.
 */
export default async function AiSettingsPage() {
  const { church } = await requireChurch();
  const t = await getT();
  const access = await getAccess();
  if (!access.isOwner) redirect("/settings");

  const [setting, view, actAs] = await Promise.all([
    getChurchAiSetting(church.id),
    getChurchSummaryView(church.id),
    getActAsChurchId(),
  ]);
  const a = view.availability;

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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">{t("ai.settingsTitle")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("ai.settingsSubtitle")}</p>
      </div>

      {!a.configured ? (
        <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">{t("ai.notConfigured")}</p>
      ) : a.killed || a.analyticsPaused ? (
        <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">{t("ai.paused")}</p>
      ) : null}

      <PlanGate feature="aiSummaries" />

      <AiSettings
        enabled={setting.enabled}
        enabledLine={enabledLine}
        configured={a.configured}
        isDemo={church.isDemo}
        isActingAs={actAs !== null}
        onPlan={a.onPlan}
        monthCount={view.monthCount}
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
