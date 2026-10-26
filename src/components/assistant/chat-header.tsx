"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Ellipsis,
  FileDown,
  FileText,
  History,
  Pencil,
  SquarePen,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { TFunction } from "@/lib/i18n/translate";
import { CONVERSATION_TITLE_MAX } from "@/lib/assistant/shared";
import { questionsLeft } from "@/lib/assistant/advisor-shared";
import { useChat } from "@/components/assistant/chat-context";
import type { ChatState } from "@/components/assistant/chat-shared";
import { pdfHref } from "@/components/assistant/chat-shared";
import { downloadPdf } from "@/components/assistant/chat-download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * "37 of 150 left this month · 12 of 25 today". The month is left out where
 * there is none (the platform scope) or it has no ceiling.
 */
export function usageLine(state: ChatState, t: TFunction): string {
  const parts: string[] = [];
  const m = state.usage.monthly;
  if (m && m.limit !== null) {
    parts.push(t("assistantPage.leftThisMonth", { left: questionsLeft(m.used, m.limit) ?? 0, max: m.limit }));
  }
  const d = state.usage.daily;
  parts.push(t("assistantPage.leftToday", { left: questionsLeft(d.used, d.limit) ?? 0, max: d.limit }));
  return parts.join(" · ");
}

/**
 * The chat's header: on a phone the History and New chat buttons (the rail
 * is not on screen there), the title (tap it to rename), which mode the next
 * question gets, what is left of the allowances, and the chat's menu.
 *
 * Under it, when answers are coming from the guides because the advisor is
 * unavailable, one line saying why, with the way out when this person is the
 * one who can take it (the plan for whoever manages billing, AI consent for
 * the owner).
 */
export function ChatHeader({
  state,
  title,
  conversationId,
  savedView,
  busy,
  onOpenHistory,
  onNewChat,
  onRename,
  onDownloadMarkdown,
  onDelete,
}: {
  state: ChatState;
  /** The open chat's title, or null for a new chat. */
  title: string | null;
  conversationId: string | null;
  /** The Saved tab is showing instead of a chat. */
  savedView: boolean;
  busy: boolean;
  onOpenHistory: () => void;
  onNewChat: () => void;
  /** Renames the chat with this id: the one the edit began on. */
  onRename: (conversationId: string, title: string) => Promise<boolean>;
  onDownloadMarkdown: () => void;
  onDelete: () => void;
}) {
  const { t, links } = useChat();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  /*
   * The chat the title box was opened for. The workspace remounts this header
   * whenever the open chat changes, so the box never outlives its chat; the
   * id travels with the save as well, so a blur can only ever rename the chat
   * it was typed for.
   */
  const editingId = useRef<string | null>(null);
  /*
   * Rename chosen from the menu starts only once the menu has closed, and
   * keeps the menu from handing focus back to its trigger: that would blur
   * the title box the moment it appeared, and blurring saves and closes it.
   */
  const renameAfterMenu = useRef(false);
  const advisor = state.usage.mode === "advisor";
  const reason = state.usage.advisorUnavailableReason;

  function startRename() {
    editingId.current = conversationId;
    setDraft(title ?? "");
    setEditing(true);
  }

  async function commitRename() {
    const next = draft.trim();
    const id = editingId.current;
    if (!next || next === title || !id || id !== conversationId) {
      setEditing(false);
      return;
    }
    setRenaming(true);
    const ok = await onRename(id, next);
    setRenaming(false);
    // A refusal keeps the box open with what they typed, so nothing is lost.
    if (ok) setEditing(false);
  }

  const heading = savedView ? t("assistantPage.tabSaved") : (title ?? t("assistantPage.newChat"));
  const noteLink =
    reason === "plan" && links.upgrade
      ? { href: links.upgrade, label: t("assistantPage.seePlans") }
      : reason === "consent" && links.consent
        ? { href: links.consent, label: t("assistantPage.turnOnAi") }
        : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* The rail's job on a phone, where the rail is not on screen. */}
        <Button
          variant="outline"
          size="icon"
          className="lg:hidden"
          onClick={onOpenHistory}
          aria-label={t("assistantPage.history")}
          title={t("assistantPage.history")}
        >
          <History className="size-4" />
        </Button>

        <div className="min-w-0 flex-1">
          {editing && conversationId && !savedView ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void commitRename();
              }}
            >
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, CONVERSATION_TITLE_MAX))}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                  }
                }}
                maxLength={CONVERSATION_TITLE_MAX}
                disabled={renaming}
                aria-label={t("assistantPage.chatTitle")}
                className="text-base font-bold sm:text-sm"
              />
            </form>
          ) : conversationId && !savedView ? (
            /*
             * The button sits inside the heading, never the other way round: a
             * button's children are presentational, so a heading inside one
             * stops being a heading and the page has none to jump to.
             */
            <h1 className="min-w-0 text-base font-bold sm:text-lg">
              <button
                type="button"
                onClick={startRename}
                className="group hover:bg-accent/60 -mx-1.5 flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-1.5 text-left sm:min-h-9"
                title={t("assistantPage.rename")}
              >
                <span className="truncate">{heading}</span>
                <Pencil
                  aria-hidden
                  className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100 max-lg:opacity-100"
                />
              </button>
            </h1>
          ) : (
            <h1 className="truncate text-base font-bold sm:text-lg">{heading}</h1>
          )}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold",
                advisor ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
              )}
              title={advisor ? t("assistantPage.modeAdvisorHint") : t("assistantPage.modeHelpHint")}
            >
              {advisor ? <Sparkles className="size-3" /> : <BookOpen className="size-3" />}
              {advisor ? t("assistantPage.modeAdvisor") : t("assistantPage.modeHelp")}
            </span>
            <span>{usageLine(state, t)}</span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onNewChat}
          disabled={busy}
          aria-label={t("assistantPage.newChat")}
          title={t("assistantPage.newChat")}
        >
          <SquarePen className="size-4" />
        </Button>

        {conversationId && !savedView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("assistantPage.chatOptions")} disabled={busy}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              onCloseAutoFocus={(e) => {
                if (!renameAfterMenu.current) return;
                renameAfterMenu.current = false;
                e.preventDefault();
                startRename();
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  renameAfterMenu.current = true;
                }}
              >
                <Pencil />
                {t("assistantPage.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadPdf(pdfHref(links.exportBase, conversationId), t)}>
                <FileDown />
                {t("assistantPage.downloadPdf")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDownloadMarkdown}>
                <FileText />
                {t("assistantPage.downloadMarkdown")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* On the next frame: the confirm dialog must not open in the tick the menu closes. */}
              <DropdownMenuItem variant="destructive" onSelect={() => requestAnimationFrame(onDelete)}>
                <Trash2 />
                {t("assistantPage.deleteChat")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {state.advisorNote && (
        <p className="text-muted-foreground rounded-lg bg-sky-500/10 px-3 py-2 text-xs">
          {state.advisorNote}
          {noteLink && (
            <>
              {" "}
              <Link href={noteLink.href} className="text-primary font-semibold underline">
                {noteLink.label}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
