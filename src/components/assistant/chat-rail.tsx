"use client";

import { Bookmark, Loader2, Plus, RotateCcw, Search } from "lucide-react";
import type { ConversationSummary, SavedAnswer } from "@/lib/assistant/shared";
import { useFormat } from "@/components/i18n-provider";
import { useChat } from "@/components/assistant/chat-context";
import { filterChats, filterSaved, type ChatTab } from "@/components/assistant/chat-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A list the rail pages through: what is loaded, whether there is more, and the state of fetching it. */
export type RailList<T> = {
  items: T[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * The history: New chat, a search over what is loaded, the Chats and Saved
 * tabs, and the list itself with Load more. The same component is the
 * desktop's left column and, on a phone, the full-screen History overlay.
 *
 * The search is a filter over the titles already on the page, not a query:
 * it costs nothing, works offline, and a person looking for last week's chat
 * has it loaded already. Load more widens what it can find.
 */
export function ChatRail({
  tab,
  onTab,
  query,
  onQuery,
  chats,
  onMoreChats,
  saved,
  onMoreSaved,
  activeId,
  onOpen,
  onOpenSaved,
  onNewChat,
  busy,
}: {
  tab: ChatTab;
  onTab: (tab: ChatTab) => void;
  query: string;
  onQuery: (q: string) => void;
  chats: RailList<ConversationSummary>;
  onMoreChats: () => void;
  /** Null until the Saved tab is first opened. */
  saved: RailList<SavedAnswer> | null;
  onMoreSaved: () => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  onOpenSaved: (s: SavedAnswer) => void;
  onNewChat: () => void;
  /**
   * A question is being answered: switching to another chat now would lose
   * sight of it, so New chat and the chat list wait. Saved answers stay open
   * to read; the answer lands in its chat either way.
   */
  busy: boolean;
}) {
  const { t } = useChat();
  const f = useFormat();
  const shownChats = filterChats(chats.items, query);
  const shownSaved = saved ? filterSaved(saved.items, query) : [];
  const list = tab === "chats" ? chats : saved;
  const shownCount = tab === "chats" ? shownChats.length : shownSaved.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 p-3">
        <Button className="w-full" onClick={onNewChat} disabled={busy}>
          <Plus className="size-4" />
          {t("assistantPage.newChat")}
        </Button>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("assistantPage.searchChats")}
            aria-label={t("assistantPage.searchChats")}
            className="pl-9 text-base sm:text-sm"
          />
        </div>
        <div role="tablist" aria-label={t("assistantPage.history")} className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
          {(["chats", "saved"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => onTab(k)}
              className={cn(
                "min-h-11 rounded-md px-2 text-sm font-semibold transition sm:min-h-9",
                tab === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "chats" ? t("assistantPage.tabChats") : t("assistantPage.tabSaved")}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" role="tabpanel">
        {!list || (list.loading && list.items.length === 0) ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-sm" aria-busy="true">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : shownCount === 0 && !list.error ? (
          <p className="text-muted-foreground px-2 py-3 text-sm">
            {query.trim()
              ? t("assistantPage.noMatches", { query: query.trim() })
              : tab === "chats"
                ? t("assistantPage.noChats")
                : t("assistantPage.noSaved")}
          </p>
        ) : tab === "chats" ? (
          <>
            {/*
              Opening another chat waits for the answer on its way: switching
              now would lose sight of it. The chats say so rather than ignoring
              a tap.
            */}
            {busy && (
              <p className="text-muted-foreground px-2.5 pb-1.5 text-xs" role="status">
                {t("assistantPage.waitForAnswer")}
              </p>
            )}
            <ul className="space-y-0.5">
              {shownChats.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    disabled={busy}
                    title={busy ? t("assistantPage.waitForAnswer") : undefined}
                    aria-current={c.id === activeId ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                      c.id === activeId ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <span className="w-full truncate text-sm font-medium">{c.title || t("assistantPage.untitled")}</span>
                    <span className="text-muted-foreground flex items-center gap-2 text-xs">
                      <time dateTime={c.lastMessageAt}>{f.date(c.lastMessageAt, "short")}</time>
                      {c.savedCount > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <Bookmark className="size-3" />
                          {t("assistantPage.savedCount", { count: c.savedCount })}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="space-y-0.5">
            {shownSaved.map((s) => (
              <li key={s.answer.id}>
                <button
                  type="button"
                  onClick={() => onOpenSaved(s)}
                  className="hover:bg-accent/60 flex min-h-11 w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition"
                >
                  <span className="line-clamp-2 w-full text-sm font-medium">
                    {s.question?.content || s.conversationTitle || t("assistantPage.untitled")}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs">
                    {s.answer.savedAt && <time dateTime={s.answer.savedAt}>{f.date(s.answer.savedAt, "short")}</time>}
                    {s.conversationTitle && ` · ${s.conversationTitle}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {list?.error && (
          <div className="space-y-2 px-2 py-3 text-sm" role="alert">
            <p className="text-rose-700 dark:text-rose-300">{list.error}</p>
            <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={tab === "chats" ? onMoreChats : onMoreSaved}>
              <RotateCcw className="size-3.5" />
              {t("assistant.retry")}
            </Button>
          </div>
        )}

        {list && list.nextCursor && !list.error && (
          <div className="px-2 pt-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={tab === "chats" ? onMoreChats : onMoreSaved}
              disabled={list.loading}
            >
              {list.loading && <Loader2 className="size-4 animate-spin" />}
              {t("assistantPage.loadMore")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
