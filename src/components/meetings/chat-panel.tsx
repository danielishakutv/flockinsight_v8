"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export type ChatMessage = {
  id: string;
  authorName: string;
  body: string;
  kind: string;
  createdAt: string;
};

/**
 * In-meeting chat.
 *
 * Also the quiet channel for anyone whose connection cannot carry a voice —
 * which is exactly the person this module exists for, so it is never hidden
 * behind a second tap on mobile.
 */
export function ChatPanel({
  messages,
  onSend,
  disabled,
}: {
  messages: ChatMessage[];
  onSend: (body: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow new messages, but only while the reader is already at the bottom —
  // yanking someone away from something they were reading is worse than a
  // missed scroll.
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
    pinnedRef.current = true;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            {t("meetings.noMessages")}
          </p>
        )}
        {messages.map((m) =>
          m.kind === "system" ? (
            <p key={m.id} className="text-center text-xs text-slate-500">
              {m.body}
            </p>
          ) : (
            <div key={m.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold text-slate-200">
                  {m.authorName}
                </span>
                <time
                  dateTime={m.createdAt}
                  className="shrink-0 text-[11px] text-slate-500"
                >
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className="mt-0.5 wrap-anywhere whitespace-pre-wrap text-slate-300">
                {m.body}
              </p>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className={cn("flex gap-2 border-t border-white/10 p-3", disabled && "opacity-50")}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            disabled ? t("meetings.chatOff") : t("meetings.messageEveryone")
          }
          maxLength={2000}
          disabled={disabled}
          aria-label={t("communication.message")}
          className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || !draft.trim()}
          aria-label={t("communication.send")}
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
