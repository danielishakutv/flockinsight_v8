"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2, Plus, Send } from "lucide-react";
import { MAX_QUESTION_CHARS } from "@/lib/assistant/shared";
import { useChat } from "@/components/assistant/chat-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Why nothing can be asked right now, when that is the case. Each is a
 * different cause with a different way out, so each says its own thing:
 * AI is off (and why), an allowance is used up (and when it comes back), or
 * this conversation is full (start another).
 *
 * A church's month that is used up offers the plan with more questions when
 * there is one; on the top plan there is none to buy, so it offers a support
 * ticket instead, which is how a church asks for a bigger allowance.
 */
export type ComposerBlock =
  | { kind: "dormant"; text: string }
  | { kind: "limit"; period: "monthly" | "daily"; text: string; resets: string; upgrade: string | null }
  | { kind: "full" };

export function ChatComposer({
  text,
  onText,
  onSend,
  sending,
  disabled,
  block,
  onNewChat,
}: {
  text: string;
  onText: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  /** While a conversation loads. */
  disabled: boolean;
  block: ComposerBlock | null;
  onNewChat: () => void;
}) {
  const { t, links } = useChat();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /*
   * Whether focus was in the composer when the question went. Pressing Send
   * with the mouse leaves focus on a button that is then disabled, and the
   * browser drops it to the page; a keyboard or screen-reader user would
   * have to find the box again for every follow-up. So once the answer is
   * in, focus goes back to the box, but only if it was here to begin with:
   * a phone keyboard must not pop up for somebody who tapped a suggestion.
   */
  const focusWasHere = useRef(false);
  const wasSending = useRef(sending);
  useEffect(() => {
    if (wasSending.current && !sending && focusWasHere.current && !disabled) inputRef.current?.focus();
    if (!sending) focusWasHere.current = false;
    wasSending.current = sending;
  }, [sending, disabled]);

  function submit() {
    // An empty box sends nothing, and must not leave a note that sends focus here after somebody else's question.
    focusWasHere.current = !!text.trim() && !!formRef.current?.contains(document.activeElement);
    onSend();
  }

  if (block) {
    return (
      <div
        role="status"
        className={cn(
          "space-y-3 rounded-2xl border p-4 text-sm",
          block.kind === "full" ? "bg-card" : "border-amber-500/40 bg-amber-500/10",
        )}
      >
        {block.kind === "dormant" && <p className="font-medium">{block.text}</p>}
        {block.kind === "limit" && (
          <p className="font-medium">
            {block.text} {block.resets}
          </p>
        )}
        {block.kind === "full" && <p>{t("assistant.conversationFull")}</p>}
        <div className="flex flex-wrap gap-2">
          {block.kind === "full" && (
            <Button onClick={onNewChat}>
              <Plus className="size-4" />
              {t("assistantPage.newChat")}
            </Button>
          )}
          {block.kind === "limit" && block.upgrade && (
            <Button asChild>
              <Link href={block.upgrade}>{t("assistantPage.upgradeForMore")}</Link>
            </Button>
          )}
          {block.kind !== "full" && links.guides && (
            <Button variant="outline" asChild>
              <Link href={links.guides}>{t("assistant.browseGuides")}</Link>
            </Button>
          )}
          {(block.kind === "dormant" || (block.kind === "limit" && block.period === "monthly" && !block.upgrade)) &&
            links.support && (
              <Button variant="outline" asChild>
                <Link href={links.support}>{t("assistant.openSupportTicket")}</Link>
              </Button>
            )}
        </div>
      </div>
    );
  }

  const left = MAX_QUESTION_CHARS - text.length;
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="bg-background focus-within:ring-ring/50 flex items-end gap-2 rounded-2xl border p-1.5 shadow-sm focus-within:ring-[3px]">
        {/*
          Read-only rather than disabled while an answer is coming: a disabled
          box loses focus, and the question cannot be sent twice anyway (the
          page ignores Send while one is out).
        */}
        <Textarea
          ref={inputRef}
          value={text}
          onChange={(e) => onText(e.target.value.slice(0, MAX_QUESTION_CHARS))}
          onKeyDown={(e) => {
            // Enter sends and Shift+Enter is a new line; never mid-composition (Chinese, Japanese, accents).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("assistant.placeholder")}
          aria-label={t("assistant.placeholder")}
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          readOnly={sending}
          aria-busy={sending || undefined}
          disabled={disabled}
          className="max-h-48 min-h-11 flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-base shadow-none focus-visible:ring-0 sm:text-sm [field-sizing:content]"
        />
        <Button
          type="submit"
          size="icon"
          className="size-11 shrink-0 rounded-xl"
          disabled={sending || disabled || !text.trim()}
          aria-label={t("assistant.send")}
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
      {left < 100 && (
        <p className={cn("mt-1 px-1 text-xs", left < 20 ? "text-rose-600" : "text-muted-foreground")}>
          {t("assistant.charactersLeft", { count: left })}
        </p>
      )}
    </form>
  );
}
