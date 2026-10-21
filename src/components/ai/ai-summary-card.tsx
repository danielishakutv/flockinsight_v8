"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/components/i18n-provider";
import { generateChurchSummaryAction } from "@/app/(app)/analytics/ai-actions";
import {
  REASON_KEY,
  isUiReason,
  summaryAvailable,
  type ChurchSummaryView,
  type UiReason,
} from "@/lib/ai/ai-shared";

type Props = {
  view: ChurchSummaryView;
  variant: "full" | "compact";
  isOwner: boolean;
  canGenerate: boolean;
  canRead: boolean;
};

/**
 * The church's plain-language summary.
 *
 * Model output is TEXT: it is split on newlines into <p> text nodes, never
 * rendered as HTML and never parsed as markdown. No plan gate is rendered here
 * (PlanGate is an async server component); the pages decide whether to mount
 * the card at all.
 */
export function AiSummaryCard({ view, variant, isOwner, canGenerate, canRead }: Props) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ reason?: UiReason; message: string } | null>(null);
  const [announce, setAnnounce] = useState("");

  const a = view.availability;
  const available = summaryAvailable(a);
  const readyToday = view.today?.status === "ready";

  if (variant === "compact") {
    const invite = isOwner && !a.optedIn && a.onPlan && a.configured && !a.killed && !a.isDemo;
    if (invite) {
      return (
        <Card className="gap-2 py-4">
          <CardContent className="flex flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm">
              <Sparkles className="text-primary size-4 shrink-0" />
              {t("ai.turnOnOwner")}
            </p>
            <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
              <Link href="/settings/ai">{t("ai.openSettings")}</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }
    // A disabled feature does not clutter the home screen.
    if (!canRead || !available) return null;
  }

  const errorText = (r: { reason?: UiReason; message: string }) => (r.reason ? t(REASON_KEY[r.reason]) : r.message);

  function generate() {
    setError(null);
    setAnnounce(t("ai.generating"));
    startTransition(async () => {
      const res = await generateChurchSummaryAction();
      if (res.ok) {
        setAnnounce(res.view.latest ? t("ai.writtenOn", { date: formatDay(res.view.latest.day) }) : "");
        router.refresh();
      } else {
        const e = { reason: res.reason, message: res.error };
        setError(e);
        setAnnounce(errorText(e));
        if (res.view) router.refresh();
      }
    });
  }

  function formatDay(day: string): string {
    // Noon, so no timezone can move the calendar day.
    return new Date(`${day}T12:00:00`).toLocaleDateString(t.intl, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  // One sentence per cause, never one sentence for five.
  let blocker: React.ReactNode = null;
  if (!a.configured) blocker = <Muted>{t("ai.notConfigured")}</Muted>;
  else if (a.killed || a.analyticsPaused) blocker = <Muted>{t("ai.paused")}</Muted>;
  else if (a.isDemo) blocker = <Muted>{t("ai.demoOff")}</Muted>;
  else if (!a.optedIn)
    blocker = isOwner ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Muted>{t("ai.turnOnOwner")}</Muted>
        <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
          <Link href="/settings/ai">{t("ai.openSettings")}</Link>
        </Button>
      </div>
    ) : (
      <Muted>{t("ai.turnOnStaff")}</Muted>
    );
  else if (!canRead) blocker = <Muted>{t("ai.roleTooNarrow")}</Muted>;

  const lines = (view.latest?.text ?? "").split(/\n+/).filter((l) => l.trim());
  const todayReason = view.today && view.today.status !== "ready" && view.today.status !== "pending"
    ? view.today.reason
    : null;

  return (
    <Card className={variant === "compact" ? "gap-3" : "mb-4 gap-3"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="text-primary size-5" />
          {t("ai.title")}
        </CardTitle>
        <CardDescription>{t("ai.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {blocker ?? (
          <>
            {lines.length > 0 && (
              <div className="space-y-2 text-sm leading-relaxed">
                {lines.map((line, i) =>
                  /^suggestion\s*:/i.test(line.trim()) ? (
                    <p key={i} className="bg-primary/5 border-primary/20 rounded-xl border px-3 py-2">
                      {line}
                    </p>
                  ) : (
                    <p key={i}>{line}</p>
                  ),
                )}
              </div>
            )}
            {lines.length === 0 && todayReason === "thin_data" && <Muted>{t("ai.thinData")}</Muted>}
            {!error && todayReason && todayReason !== "thin_data" && isUiReason(todayReason) && (
              <Muted>{t(REASON_KEY[todayReason])}</Muted>
            )}
            {error && (
              <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm" role="status">
                {errorText(error)}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {view.latest ? (
                <p className="text-muted-foreground text-xs">
                  {t("ai.writtenOn", { date: formatDay(view.latest.day) })}
                </p>
              ) : (
                <span />
              )}
              {canGenerate && (
                <div className="flex flex-col items-stretch gap-1 sm:items-end">
                  <Button
                    onClick={generate}
                    disabled={pending || readyToday}
                    aria-busy={pending}
                    className="w-full sm:w-auto"
                    size="sm"
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {pending ? t("ai.generating") : t("ai.generate")}
                  </Button>
                  {readyToday && <span className="text-muted-foreground text-xs">{t("ai.nextTomorrow")}</span>}
                </div>
              )}
            </div>
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </CardContent>
    </Card>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
