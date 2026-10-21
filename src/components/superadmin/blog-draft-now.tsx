"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { draftPostNow, getDraftRun } from "@/app/superadmin/blog/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "writing"; runId: string }
  | { kind: "error"; message: string };

const POLL_MS = 3000;

/**
 * "Draft one now". The action returns as soon as the run row exists and the
 * dialog polls it, so a draft that takes minutes never holds a request open
 * long enough for Cloudflare to cut it. Closing the dialog mid-run is safe:
 * the draft still lands, and the strip on the page shows how it went.
 */
export function BlogDraftNow({
  topics,
  nextKey,
  disabledReason,
}: {
  topics: { key: string; question: string; used: boolean }[];
  nextKey: string | null;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [topicKey, setTopicKey] = useState(nextKey ?? topics[0]?.key ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (phase.kind !== "writing" || !open) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getDraftRun({ runId: phase.runId });
        if (cancelled) return;
        if (!res.ok) return setPhase({ kind: "error", message: res.error });
        const run = res.run;
        if (run.status === "drafted" && run.postId) {
          router.push(`/superadmin/blog/${run.postId}`);
          return;
        }
        if (run.status === "failed" || run.status === "skipped") {
          return setPhase({ kind: "error", message: run.error ?? `The draft ${run.status}.` });
        }
        if (run.status === "interrupted") {
          return setPhase({
            kind: "error",
            message: "The draft was interrupted (the server may have restarted). Try again.",
          });
        }
      } catch (e) {
        console.error("[blog-draft-now] poll failed", e);
        // A dropped poll is not a failed draft; keep asking.
      }
      if (!cancelled) timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, open, router]);

  async function start() {
    setPhase({ kind: "starting" });
    try {
      const res = await draftPostNow({ topicKey });
      if (!res.ok) return setPhase({ kind: "error", message: res.error });
      setPhase({ kind: "writing", runId: res.runId });
    } catch (e) {
      console.error("[blog-draft-now] start failed", e);
      setPhase({ kind: "error", message: "Could not start the draft. Check your connection and try again." });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Closing mid-run is fine: the run continues; the page shows the result.
      if (phase.kind === "writing") router.refresh();
      setPhase({ kind: "idle" });
    }
  }

  const busy = phase.kind === "starting" || phase.kind === "writing";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? undefined}
      >
        <Sparkles className="size-4" />
        Draft one now
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft a blog post</DialogTitle>
            <DialogDescription>
              Written by AI from the keyword map and the SEO pages, saved as a draft. Nothing is
              public until someone reads it and publishes it.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Topic</span>
            <select
              value={topicKey}
              onChange={(e) => setTopicKey(e.target.value)}
              disabled={busy}
              className="border-input bg-background h-10 w-full rounded-md border px-2 text-sm"
            >
              {topics.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.used ? "✓ " : ""}
                  {t.question}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground block text-xs">
              ✓ marks a topic that already has a draft. You can still pick it.
            </span>
          </label>
          {phase.kind === "writing" && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm" aria-live="polite">
              <Loader2 className="size-4 animate-spin" />
              Writing — this takes about a minute. You can close this; the draft still lands.
            </p>
          )}
          {phase.kind === "error" && (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300" role="alert">
              {phase.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={start} disabled={busy || !topicKey}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
