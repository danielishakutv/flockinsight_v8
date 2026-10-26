"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareText, PenLine, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  createCannedAnswer,
  dismissQueueItem,
  draftCannedAnswer,
} from "@/app/superadmin/assistant/actions";
import { Button } from "@/components/ui/button";

export type QueueItem = {
  id: string;
  conversationId: string;
  churchName: string;
  reason:
    | "Unhelpful"
    | "Not in the guides"
    | "No sources"
    | "Declined"
    | "Cut off"
    | "Failed"
    | "Figures not in the data";
  /** The mode that answered: an advisor answer quotes the church's figures. */
  mode: "help" | "advisor";
  question: string;
  answer: string;
  createdAt: string;
};

const REASON_STYLE: Record<QueueItem["reason"], string> = {
  Unhelpful: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "Not in the guides": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "No sources": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Declined: "bg-muted text-muted-foreground",
  "Cut off": "bg-muted text-muted-foreground",
  Failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "Figures not in the data": "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/**
 * The answers that need a look. Each one can become a canned answer (drafted
 * by AI or written by hand, approved by a human either way) or be dismissed
 * when there is nothing to learn from it.
 *
 * "Figures not in the data" is an advisor answer quoting a number the check
 * could not find in the figures it was given. A canned answer cannot fix
 * that (canned answers are platform-wide how-to text), so the thing to do is
 * read it against the conversation, then dismiss it or note the prompt for
 * the next version.
 */
export function AssistantQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        console.error("[assistant-queue] action failed", e);
        toast.error("That did not go through. Check your connection and try again.");
      } finally {
        setBusy(null);
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center text-sm">
        Nothing to review: every recent answer was grounded, its figures checked, and nobody said it didn&apos;t
        help.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="bg-card space-y-3 rounded-2xl border p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-semibold ${REASON_STYLE[item.reason]}`}>
              {item.reason}
            </span>
            <span
              className={
                item.mode === "advisor"
                  ? "rounded bg-violet-500/10 px-1.5 py-0.5 font-semibold text-violet-700 dark:text-violet-300"
                  : "bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-semibold"
              }
            >
              {item.mode === "advisor" ? "Advisor" : "Help"}
            </span>
            <span className="text-muted-foreground">{item.churchName}</span>
            <span className="text-muted-foreground">
              · {new Date(item.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-semibold">Question (as stored, scrubbed)</p>
              <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                {item.question || "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-semibold">Answer given</p>
              <p className="mt-1 line-clamp-6 text-sm break-words whitespace-pre-wrap">{item.answer}</p>
            </div>
          </div>
          {item.mode === "advisor" && (
            <p className="text-muted-foreground text-xs">
              This answer quotes one church&apos;s figures, so it is not drafted with AI: a canned answer is shown
              to every church. Write one by hand if the question was really a how-to question.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {item.mode === "help" && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  run(item.id, async () => {
                    const res = await draftCannedAnswer({ messageId: item.id });
                    if (!res.ok) return void toast.error(res.error);
                    if (res.note) toast.message(res.note);
                    router.push(`/superadmin/assistant/answers/${res.id}`);
                  })
                }
              >
                {busy === item.id ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Draft with AI
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(item.id, async () => {
                  const res = await createCannedAnswer({ messageId: item.id });
                  if (!res.ok) return void toast.error(res.error);
                  router.push(`/superadmin/assistant/answers/${res.id}`);
                })
              }
            >
              <PenLine className="size-4" />
              Write an answer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                run(item.id, async () => {
                  const res = await dismissQueueItem({ messageId: item.id });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Dismissed");
                  router.refresh();
                })
              }
            >
              <X className="size-4" />
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/superadmin/assistant/conversations/${item.conversationId}`}>
                <MessageSquareText className="size-4" />
                View conversation
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
