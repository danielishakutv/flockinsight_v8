// RETIRED (0.83.0): the assistant is its own page now (chat-workspace.tsx at /assistant and /superadmin/ask); nothing imports this panel, and it stays only so its history is easy to read.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircleQuestionMark, RotateCcw, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  getAssistantThread,
  rateAssistantAnswer,
  sendAssistantMessage,
} from "@/app/(app)/help/assistant-actions";
import {
  getPlatformAssistantThread,
  ratePlatformAssistantAnswer,
  sendPlatformAssistantMessage,
} from "@/app/superadmin/assistant/actions";
import type { TFunction } from "@/lib/i18n/translate";
import {
  MAX_CONVERSATION_MESSAGES,
  MAX_QUESTION_CHARS,
  type AssistantThreadItem,
} from "@/lib/assistant/shared";
import { AssistantAnswer } from "@/components/assistant/assistant-answer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Scope = "church" | "platform";

type Item =
  | AssistantThreadItem
  | { role: "pending"; id: string; content: string }
  | { role: "error"; id: string; content: string };

const ACTIONS = {
  church: {
    load: getAssistantThread,
    send: sendAssistantMessage,
    rate: rateAssistantAnswer,
  },
  platform: {
    load: getPlatformAssistantThread,
    send: sendPlatformAssistantMessage,
    rate: ratePlatformAssistantAnswer,
  },
} as const;

/**
 * The conversation itself. Mounted only while the dialog is open, so a closed
 * assistant costs nothing on every page.
 *
 * Every state says which state it is: loading shows skeleton bubbles, a load
 * failure says so with Retry, a refused question says why in a red bubble and
 * keeps the text in the box, and a dormant assistant says it is off and why,
 * with the guides and support one tap away. None of them is an empty panel.
 */
export function AssistantPanel({ scope, t }: { scope: Scope; t: TFunction }) {
  const actions = ACTIONS[scope];
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [dormant, setDormant] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [rated, setRated] = useState<Record<string, "thanks" | "sorry">>({});
  const scroller = useRef<HTMLDivElement>(null);
  // Local ids for bubbles that have no row yet (pending, errors).
  const seq = useRef(0);
  const localId = (prefix: string) => `${prefix}-${++seq.current}`;

  const fetchThread = useCallback(
    (isCurrent: () => boolean) =>
      actions
        .load({})
        .then((res) => {
          if (!isCurrent()) return;
          if (!res.ok) {
            setLoadError(res.error);
            return;
          }
          setConversationId(res.conversationId);
          setItems(res.items);
          setDormant(res.dormant);
          setFull(res.messageCount + 2 > MAX_CONVERSATION_MESSAGES);
        })
        .catch((e) => {
          console.error("[assistant] could not load the conversation", e);
          if (isCurrent()) setLoadError(t("assistant.loadFailed"));
        })
        .finally(() => {
          if (isCurrent()) setLoading(false);
        }),
    [actions, t],
  );

  useEffect(() => {
    let current = true;
    void fetchThread(() => current);
    return () => {
      current = false;
    };
  }, [fetchThread]);

  function retryLoad() {
    setLoading(true);
    setLoadError(null);
    void fetchThread(() => true);
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items, sending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || sending) return;
    const pendingId = localId("pending");
    setItems((xs) => [...xs.filter((x) => x.role !== "error"), { role: "pending", id: pendingId, content: q }]);
    setText("");
    setSending(true);
    try {
      const res = await actions.send({ conversationId, text: q });
      if (res.ok) {
        setConversationId(res.conversationId);
        setItems((xs) => [
          ...xs.filter((x) => x.id !== pendingId),
          // The bubble keeps what they typed; a reload shows the stored,
          // scrubbed text, placeholders and all.
          { role: "user", id: res.question.id, content: q, redactions: res.question.redactions },
          res.answer,
        ]);
        return;
      }
      setItems((xs) => xs.filter((x) => x.id !== pendingId));
      if (res.code === "dormant" || res.code === "notInDemo") {
        setDormant(res.error);
        return;
      }
      if (res.code === "conversationFull") setFull(true);
      setText(q);
      setItems((xs) => [...xs, { role: "error", id: localId("error"), content: res.error }]);
    } catch (e) {
      console.error("[assistant] send failed", e);
      setItems((xs) => [
        ...xs.filter((x) => x.id !== pendingId),
        { role: "error", id: localId("error"), content: t("assistant.failed") },
      ]);
      setText(q);
    } finally {
      setSending(false);
    }
  }

  async function rate(id: string, helpful: boolean) {
    const before = items;
    setItems((xs) =>
      xs.map((x) => (x.role === "assistant" && x.id === id ? { ...x, helpful } : x)),
    );
    setRated((r) => ({ ...r, [id]: helpful ? "thanks" : "sorry" }));
    try {
      const res = await actions.rate({ messageId: id, helpful });
      if (res.ok) return;
      setItems(before);
      setRated((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      setItems((xs) => [...xs, { role: "error", id: localId("error"), content: res.error }]);
    } catch (e) {
      console.error("[assistant] feedback failed", e);
      setItems(before);
      setItems((xs) => [...xs, { role: "error", id: localId("error"), content: t("assistant.feedbackFailed") }]);
    }
  }

  function newConversation() {
    setConversationId(null);
    setItems([]);
    setFull(false);
    setRated({});
  }

  const left = MAX_QUESTION_CHARS - text.length;
  const suggestions = [
    t("assistant.suggestionSms"),
    t("assistant.suggestionImport"),
    t("assistant.suggestionAttendance"),
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b py-3 pr-14 pl-4">
        <div className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
          <MessageCircleQuestionMark className="size-4" />
        </div>
        <p className="min-w-0 flex-1 truncate font-bold">{t("assistant.helpAssistant")}</p>
        {items.length > 0 && !dormant && (
          <Button variant="ghost" size="sm" onClick={newConversation} disabled={sending}>
            <RotateCcw className="size-3.5" />
            <span className="max-sm:sr-only">{t("assistant.newConversation")}</span>
          </Button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-24 w-5/6 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          </div>
        ) : loadError ? (
          <div className="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
            <p>{loadError}</p>
            <Button variant="outline" size="sm" onClick={retryLoad}>
              <RotateCcw className="size-3.5" />
              {t("assistant.retry")}
            </Button>
          </div>
        ) : (
          <>
            {items.length === 0 && (
              <div className="space-y-3 text-sm">
                <p className="font-medium">{t("assistant.intro")}</p>
                <p className="text-muted-foreground">{t("assistant.privacyNotice")}</p>
                <p className="text-muted-foreground">{t("assistant.keptNotice")}</p>
                <p className="text-muted-foreground">{t("assistant.aiNotice")}</p>
                {!dormant && (
                  <div className="flex flex-col gap-2 pt-1">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        disabled={sending}
                        className="hover:bg-accent rounded-xl border px-3 py-2 text-left text-sm transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {items.map((item) => (
              <Bubble
                key={item.id}
                item={item}
                t={t}
                rated={rated[item.id]}
                onRate={rate}
                supportLink={scope === "church"}
              />
            ))}
            {sending && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm" aria-live="polite">
                <Loader2 className="size-4 animate-spin" />
                {t("assistant.thinking")}
              </div>
            )}
            {dormant && (
              <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" role="status">
                <p className="font-medium">{dormant}</p>
                {scope === "church" && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/help">{t("assistant.browseGuides")}</Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/help/support">{t("assistant.openSupportTicket")}</Link>
                    </Button>
                  </div>
                )}
              </div>
            )}
            {full && !dormant && (
              <div className="space-y-2 rounded-2xl border p-4 text-sm">
                <p>{t("assistant.conversationFull")}</p>
                <Button size="sm" onClick={newConversation}>
                  {t("assistant.newConversation")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {!dormant && !loadError && (
        <form
          className="border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_QUESTION_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder={t("assistant.placeholder")}
              aria-label={t("assistant.placeholder")}
              rows={2}
              maxLength={MAX_QUESTION_CHARS}
              disabled={sending || loading || full}
              className="max-h-40 min-h-11 flex-1 resize-none text-base sm:text-sm"
            />
            <Button
              type="submit"
              size="icon"
              className="size-11 shrink-0"
              disabled={sending || loading || full || !text.trim()}
              aria-label={t("assistant.send")}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
          {left < 100 && (
            <p className={cn("mt-1 text-xs", left < 20 ? "text-rose-600" : "text-muted-foreground")}>
              {t("assistant.charactersLeft", { count: left })}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function Bubble({
  item,
  t,
  rated,
  onRate,
  supportLink,
}: {
  item: Item;
  t: TFunction;
  rated?: "thanks" | "sorry";
  onRate: (id: string, helpful: boolean) => void;
  /** Support tickets are a church thing; the superadmin shell has no /help. */
  supportLink: boolean;
}) {
  if (item.role === "user" || item.role === "pending") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div
          className={cn(
            "bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm break-words whitespace-pre-wrap",
            item.role === "pending" && "opacity-70",
          )}
        >
          {item.content}
        </div>
        {item.role === "user" && item.redactions > 0 && (
          <p className="text-muted-foreground text-xs">
            {t("assistant.removedDetails", { count: item.redactions })}
          </p>
        )}
      </div>
    );
  }
  if (item.role === "error") {
    return (
      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300" role="alert">
        {item.content}
      </div>
    );
  }
  const answered = item.kind === "answered";
  return (
    <div className="bg-muted/60 max-w-[92%] space-y-2 rounded-2xl rounded-bl-md px-3 py-2 text-sm">
      {answered ? <AssistantAnswer>{item.content}</AssistantAnswer> : <p>{item.content}</p>}
      {answered && item.sources.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-semibold">{t("assistant.fromTheGuides")}</p>
          <div className="flex flex-wrap gap-1.5">
            {item.sources.map((s) =>
              s.href ? (
                <Link
                  key={s.ref}
                  href={s.href}
                  className="bg-background hover:border-primary rounded-full border px-2.5 py-1 text-xs font-medium"
                >
                  {s.title}
                </Link>
              ) : (
                <span key={s.ref} className="bg-background rounded-full border px-2.5 py-1 text-xs">
                  {s.title}
                </span>
              ),
            )}
          </div>
        </div>
      )}
      {answered && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {rated === "thanks" || (item.helpful === true && !rated) ? (
            <p className="text-muted-foreground text-xs">{t("assistant.thanksForFeedback")}</p>
          ) : rated === "sorry" || item.helpful === false ? (
            <p className="text-muted-foreground text-xs">
              {t("assistant.sorryNotHelpful")}
              {supportLink && (
                <>
                  {" "}
                  <Link href="/help/support" className="text-primary font-medium underline">
                    {t("assistant.openSupportTicket")}
                  </Link>
                </>
              )}
            </p>
          ) : (
            <>
              <span className="text-muted-foreground text-xs">{t("assistant.didThisHelp")}</span>
              <Button variant="outline" size="sm" className="h-8" onClick={() => onRate(item.id, true)}>
                <ThumbsUp className="size-3.5" />
                {t("assistant.yes")}
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => onRate(item.id, false)}>
                <ThumbsDown className="size-3.5" />
                {t("assistant.no")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
