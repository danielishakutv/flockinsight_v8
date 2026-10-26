"use client";

import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import type { ChatAnswer, SavedAnswer } from "@/lib/assistant/shared";
import { useFormat } from "@/components/i18n-provider";
import { AnswerCard, QuestionBubble } from "@/components/assistant/chat-answer";
import { useChat } from "@/components/assistant/chat-context";
import type { RailList } from "@/components/assistant/chat-rail";
import { filterSaved } from "@/components/assistant/chat-shared";
import { ThreadSkeleton } from "@/components/assistant/chat-thread";
import { Button } from "@/components/ui/button";

/**
 * The Saved tab, in full: every saved answer with the question it answered,
 * readable and downloadable without opening each chat. The rail's list on
 * the same tab jumps to a card here. A saved answer outlives the 180-day
 * sweep, so this is where somebody comes back to the ones that mattered.
 */
export function ChatSaved({
  saved,
  query,
  onMore,
  onOpenChat,
  busy,
  rated,
  onRate,
  onSave,
  savingIds,
}: {
  saved: RailList<SavedAnswer> | null;
  query: string;
  onMore: () => void;
  onOpenChat: (conversationId: string) => void;
  /** A question is being answered: Open chat waits for it, and says so. */
  busy: boolean;
  rated: Record<string, "thanks" | "sorry">;
  onRate: (id: string, helpful: boolean) => void;
  onSave: (answer: ChatAnswer, saved: boolean) => void;
  savingIds: ReadonlySet<string>;
}) {
  const { t } = useChat();
  const f = useFormat();

  if (!saved || (saved.loading && saved.items.length === 0)) return <ThreadSkeleton />;

  const shown = filterSaved(saved.items, query);
  return (
    <div className="space-y-6">
      {shown.length === 0 && !saved.error && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {query.trim() ? t("assistantPage.noMatches", { query: query.trim() }) : t("assistantPage.noSaved")}
        </p>
      )}

      {shown.map((s) => (
        <section
          key={s.answer.id}
          id={`saved-${s.answer.id}`}
          className="scroll-mt-48 space-y-3 border-b pb-6 last:border-b-0 lg:scroll-mt-6"
          aria-label={s.conversationTitle || t("assistantPage.untitled")}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground min-w-0 truncate text-xs">
              {s.answer.savedAt && <time dateTime={s.answer.savedAt}>{f.date(s.answer.savedAt)}</time>}
              {s.conversationTitle && ` · ${s.conversationTitle}`}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => onOpenChat(s.conversationId)}
              disabled={busy}
              title={busy ? t("assistantPage.waitForAnswer") : undefined}
            >
              {t("assistantPage.openChat")}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
          {s.question && <QuestionBubble question={s.question} />}
          <AnswerCard
            answer={s.answer}
            question={s.question}
            conversationId={s.conversationId}
            conversationTitle={s.conversationTitle}
            rated={rated[s.answer.id]}
            onRate={onRate}
            onSave={onSave}
            saving={savingIds.has(s.answer.id)}
          />
        </section>
      ))}

      {saved.error && (
        <div className="space-y-2 text-sm" role="alert">
          <p className="text-rose-700 dark:text-rose-300">{saved.error}</p>
          <Button variant="outline" onClick={onMore}>
            <RotateCcw className="size-4" />
            {t("assistant.retry")}
          </Button>
        </div>
      )}

      {saved.nextCursor && !saved.error && (
        <Button variant="outline" className="w-full" onClick={onMore} disabled={saved.loading}>
          {saved.loading && <Loader2 className="size-4 animate-spin" />}
          {t("assistantPage.loadMore")}
        </Button>
      )}
    </div>
  );
}
