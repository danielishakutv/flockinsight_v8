"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { generateFinanceBriefing } from "@/app/superadmin/finance/profit/actions";
import type { PlatformSummaryView } from "@/lib/ai/ai-shared";
import { Button } from "@/components/ui/button";

/** English-only reasons for the operator, one sentence per cause. */
const REASON_TEXT: Record<string, string> = {
  not_configured: "AI is dormant: nothing is sent. Set ANTHROPIC_API_KEY on the server and restart with --update-env.",
  killed: "The kill switch is on in AI controls, so nothing is sent.",
  feature_paused: "Analytics summaries are paused in AI controls, and this briefing is one of them.",
  platform_budget: "This month's platform AI ceiling has been reached. Briefings resume on the 1st (UTC).",
  refused: "The model declined to write this briefing. Try again tomorrow.",
  truncated: "The briefing ran too long and was not saved. Try again.",
  payload_rejected: "The figures failed the allow-list, so nothing was sent. The AI page has the details.",
  provider_error: "The AI provider failed. Try again in a few minutes; the AI page has the error.",
  in_progress: "A briefing is already being written. Refresh in a minute.",
  tried_today: "Three attempts have been made today. Try again tomorrow.",
  too_fast: "Too many tries in a row. Wait a minute.",
  thin_data: "There are no revenue or costs in the last three finished months to write about yet.",
};

/**
 * A second opinion in prose. The rules beside it are the primary source and
 * are always on; this is written by AI from shares, percentages and counts
 * only, so it never states a naira figure. Model output renders as text only.
 */
export function FinanceBriefing({ view }: { view: PlatformSummaryView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const a = view.availability;
  const readyToday = view.today?.status === "ready";
  const lines = (view.latest?.text ?? "").split(/\n+/).filter((l) => l.trim());
  const stored = view.today && view.today.status !== "ready" && view.today.status !== "pending" ? view.today.reason : null;
  const storedText = stored ? (REASON_TEXT[stored] ?? `The last attempt failed (${stored}). The AI page has the details.`) : null;

  let blocker: string | null = null;
  if (!a.configured) blocker = "AI is dormant: nothing is sent.";
  else if (a.killed) blocker = REASON_TEXT.killed;
  else if (a.analyticsPaused) blocker = REASON_TEXT.feature_paused;

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generateFinanceBriefing();
      if (!res.ok) setError((res.reason && REASON_TEXT[res.reason]) || res.error);
      router.refresh();
    });
  }

  return (
    <div className="bg-card space-y-3 rounded-2xl border p-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-bold">
          <Sparkles className="text-primary size-4" /> AI&apos;s reading of the last three months
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          From shares, margins and counts only: no naira figure and no church name leaves the platform.
        </p>
      </div>
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
      {blocker ? (
        <p className="text-muted-foreground text-sm">{blocker}</p>
      ) : (
        <>
          {(error || storedText) && (
            <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm" role="status">
              {error ?? storedText}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              {view.latest ? `Written ${view.latest.day}${view.latest.reused ? " (figures unchanged, text reused)" : ""}` : "No briefing yet."}
            </p>
            <Button size="sm" variant="outline" onClick={generate} disabled={pending || readyToday} aria-busy={pending} className="w-full sm:w-auto">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {pending ? "Writing…" : readyToday ? "Written today" : "Write today's briefing"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
