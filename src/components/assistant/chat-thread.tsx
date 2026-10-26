"use client";

import { forwardRef } from "react";
import { BookOpen, Loader2, Sparkles } from "lucide-react";
import type { AssistantMode, ChatAnswer, ChatItem, ChatQuestion } from "@/lib/assistant/shared";
import { AnswerCard, QuestionBubble } from "@/components/assistant/chat-answer";
import { useChat } from "@/components/assistant/chat-context";
import { Skeleton } from "@/components/ui/skeleton";

/** A row of the thread: a stored row, or one that has no row yet. */
export type ThreadItem =
  | ChatItem
  | { role: "pending"; id: string; content: string }
  | { role: "error"; id: string; content: string };

/** What the empty thread offers, which depends on the mode the next question gets. */
export type EmptyCopy = { intro: string; suggestions: string[] };

/**
 * The conversation: its questions and answers, the question being answered
 * right now, and refusals as red rows that say why. With nothing in it yet,
 * it says what the assistant can do in the current mode, offers four
 * questions to start from, and says what happens to what is typed.
 */
export const ChatThread = forwardRef<
  HTMLDivElement,
  {
    items: ThreadItem[];
    mode: AssistantMode;
    sending: boolean;
    /** Read out once the latest answer has landed; "" before any. */
    announcement: string;
    empty: EmptyCopy;
    /** False while nothing can be asked (AI off, an allowance used): the suggestions would only be refused. */
    canAsk: boolean;
    onSuggestion: (q: string) => void;
    conversationId: string | null;
    conversationTitle: string;
    rated: Record<string, "thanks" | "sorry">;
    onRate: (id: string, helpful: boolean) => void;
    onSave: (answer: ChatAnswer, saved: boolean) => void;
    savingIds: ReadonlySet<string>;
  }
>(function ChatThread(props, endRef) {
  const { t } = useChat();
  const { items } = props;
  const pendingText = props.mode === "advisor" ? t("assistantPage.pendingAdvisor") : t("assistant.thinking");

  // Each answer's question, for its downloads: the latest question at or before it.
  const questionOf = new Map<string, ChatQuestion | null>();
  let lastQuestion: ChatQuestion | null = null;
  for (const item of items) {
    if (item.role === "user") lastQuestion = item;
    else if (item.role === "assistant") questionOf.set(item.id, lastQuestion);
  }

  return (
    <div className="space-y-4">
      {/*
        Always mounted, so a screen reader hears each change: the wait, then
        that the answer is in. A region added already filled is often never
        read, and putting the whole thread in a live region would read every
        button on every answer card aloud.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {props.sending ? pendingText : props.announcement}
      </div>

      {items.length === 0 && !props.sending && (
        <div className="mx-auto max-w-2xl space-y-4 py-2 text-sm sm:py-6">
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
              {props.mode === "advisor" ? <Sparkles className="size-5" /> : <BookOpen className="size-5" />}
            </span>
            <p className="pt-0.5 text-base font-medium">{props.empty.intro}</p>
          </div>
          {props.canAsk && (
            <div className="grid gap-2 sm:grid-cols-2">
              {props.empty.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => props.onSuggestion(s)}
                  className="hover:bg-accent hover:border-primary/40 bg-card min-h-11 rounded-xl border px-3.5 py-2.5 text-left text-sm transition"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="text-muted-foreground space-y-1.5 border-t pt-3 text-xs">
            <p>{t("assistant.privacyNotice")}</p>
            <p>{t("assistantPage.aiNotice")}</p>
            <p>{t("assistantPage.keptNotice")}</p>
          </div>
        </div>
      )}

      {items.map((item) => {
        if (item.role === "user") return <QuestionBubble key={item.id} question={item} />;
        if (item.role === "pending") {
          return <QuestionBubble key={item.id} question={{ content: item.content, redactions: 0 }} />;
        }
        if (item.role === "error") {
          return (
            <div
              key={item.id}
              role="alert"
              className="max-w-[85%] rounded-2xl rounded-bl-md border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300"
            >
              {item.content}
            </div>
          );
        }
        return (
          <div key={item.id} id={`answer-${item.id}`} className="scroll-mt-48 lg:scroll-mt-6">
            <AnswerCard
              answer={item}
              question={questionOf.get(item.id) ?? null}
              conversationId={props.conversationId}
              conversationTitle={props.conversationTitle}
              rated={props.rated[item.id]}
              onRate={props.onRate}
              onSave={props.onSave}
              saving={props.savingIds.has(item.id)}
            />
          </div>
        );
      })}

      {props.sending && (
        // Seen here, heard through the status region above.
        <div className="text-muted-foreground flex items-center gap-2 text-sm" aria-hidden>
          <Loader2 className="size-4 animate-spin" />
          {pendingText}
        </div>
      )}

      {/*
        The scroll target after every change. Its bottom margin keeps the last
        answer clear of the composer, which on a phone is pinned over the
        bottom of the page rather than below it.
      */}
      <div ref={endRef} aria-hidden className="h-px scroll-mb-48 lg:scroll-mb-4" />
    </div>
  );
});

/** Skeleton bubbles while a conversation loads, so the wait looks like what it is. */
export function ThreadSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
      <Skeleton className="h-28 w-5/6 rounded-2xl" />
      <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
      <Skeleton className="h-20 w-4/6 rounded-2xl" />
    </div>
  );
}
