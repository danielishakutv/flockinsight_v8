"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * The @ that is actually starting a mention, and what has been typed after it.
 *
 * Only counts at the start of the message or after a space, so an email
 * address does not open the picker halfway through being typed. Returns null
 * once a space follows the name, because by then the person has moved on.
 */
export function mentionQuery(
  text: string,
  caret: number,
): { at: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { at, query };
}

/** Split a message so the @names in it can be picked out and styled. */
export function splitMentions(body: string, names: string[]): string[] {
  if (names.length === 0) return [body];
  // Longest first, so "@Mary Jane" wins over "@Mary".
  const escaped = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "gi")).filter(Boolean);
}

export function ChatPanel({
  messages,
  onSend,
  disabled,
  people = [],
  myName,
}: {
  messages: ChatMessage[];
  onSend: (body: string) => void;
  disabled?: boolean;
  /** Everyone who can be mentioned, in roster order. */
  people?: string[];
  /** So a mention of this person can be picked out of the thread. */
  myName?: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return people.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, people]);

  const syncMention = (value: string, caret: number) => {
    const next = mentionQuery(value, caret);
    setMention(next);
    setHighlighted(0);
  };

  const choose = (name: string) => {
    if (!mention) return;
    const before = draft.slice(0, mention.at);
    const after = draft.slice(mention.at + 1 + mention.query.length);
    // The trailing space is deliberate: without it the next word joins the
    // name and the mention stops matching anything.
    const next = `${before}@${name} ${after.startsWith(" ") ? after.slice(1) : after}`;
    setDraft(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = before.length + name.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!mention || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter completes the name rather than sending — sending a half-typed
      // mention is the thing people would otherwise do every time.
      e.preventDefault();
      choose(matches[highlighted]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
    setMention(null);
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
                {splitMentions(m.body, people).map((part, i) =>
                  part.startsWith("@") &&
                  people.some((n) => `@${n}`.toLowerCase() === part.toLowerCase()) ? (
                    <span
                      key={i}
                      className={cn(
                        "rounded px-1 font-semibold",
                        myName && part.toLowerCase() === `@${myName.toLowerCase()}`
                          ? // Addressed to you: brighter, because the whole
                            // point of a mention is being able to spot it in a
                            // thread you have stopped reading.
                            "bg-amber-400/25 text-amber-200"
                          : "bg-indigo-400/20 text-indigo-200",
                      )}
                    >
                      {part}
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  ),
                )}
              </p>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className={cn(
          "relative flex gap-2 border-t border-white/10 p-3",
          disabled && "opacity-50",
        )}
      >
        {mention && matches.length > 0 && (
          <ul
            className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-xl"
            role="listbox"
            aria-label={t("meetings.mentionSomeone")}
          >
            {matches.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseEnter={() => setHighlighted(i)}
                  // onMouseDown, not onClick: the input blurs before a click
                  // lands, which closes the list out from under the pointer.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(name);
                  }}
                  className={cn(
                    "block w-full truncate px-3 py-2 text-left text-sm",
                    i === highlighted ? "bg-white/10 text-white" : "text-slate-300",
                  )}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setMention(null)}
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
