"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { generatePlatformSummaryAction } from "@/app/superadmin/ai/actions";
import type { PlatformSummaryView } from "@/lib/ai/ai-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** English-only reasons for the operator, one sentence per cause. */
const REASON_TEXT: Record<string, string> = {
  not_configured: "AI is dormant: nothing is sent. Set ANTHROPIC_API_KEY on the server and restart with --update-env.",
  killed: "The kill switch is on in AI controls, so nothing is sent.",
  feature_paused: "Analytics summaries are paused in AI controls.",
  platform_budget: "This month's platform AI ceiling has been reached. Summaries resume on the 1st (UTC).",
  refused: "The model declined to write this summary. Try again tomorrow.",
  truncated: "The summary ran too long and was not saved. Try again.",
  payload_rejected: "The figures failed the allow-list, so nothing was sent. The AI page has the details.",
  provider_error: "The AI provider failed. Try again in a few minutes; the AI page has the error.",
  in_progress: "A summary is already being written. Refresh in a minute.",
  tried_today: "Three attempts have been made today. Try again tomorrow.",
  too_fast: "Too many tries in a row. Wait a minute.",
};

/**
 * The operator's daily briefing on the overview page. Model output is
 * rendered as text nodes only, never HTML.
 */
export function PlatformAiSummary({ view }: { view: PlatformSummaryView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const a = view.availability;
  const readyToday = view.today?.status === "ready";
  const lines = (view.latest?.text ?? "").split(/\n+/).filter((l) => l.trim());
  const stored = view.today && view.today.status === "failed" ? view.today.reason : null;
  // A failed day always says something, even for a cause this map does not
  // name (invalid_input is a programming error and belongs on the AI page).
  const storedText = stored
    ? (REASON_TEXT[stored] ?? `The last attempt failed (${stored}). The AI page has the details.`)
    : null;

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generatePlatformSummaryAction();
      if (!res.ok) setError((res.reason && REASON_TEXT[res.reason]) || res.error);
      router.refresh();
    });
  }

  let blocker: string | null = null;
  if (!a.configured) blocker = "AI is dormant: nothing is sent.";
  else if (a.killed) blocker = REASON_TEXT.killed;
  else if (a.analyticsPaused) blocker = REASON_TEXT.feature_paused;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="text-primary size-4" />
          Today in plain words
        </CardTitle>
        <CardDescription>
          Written by AI from platform counts and percentage changes only. No church is named.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
                {view.latest ? `Written ${view.latest.day}${view.latest.reused ? " (figures unchanged, text reused)" : ""}` : "No summary yet."}
              </p>
              <Button
                size="sm"
                onClick={generate}
                disabled={pending || readyToday}
                aria-busy={pending}
                className="w-full sm:w-auto"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {pending ? "Writing…" : readyToday ? "Written today" : "Write today's summary"}
              </Button>
            </div>
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {pending ? "Writing the summary" : (error ?? "")}
        </p>
      </CardContent>
    </Card>
  );
}
