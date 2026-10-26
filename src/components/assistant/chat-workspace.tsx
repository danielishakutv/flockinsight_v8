"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import {
  askQuestion as askChurch,
  deleteChat as deleteChurchChat,
  listChats as listChurchChats,
  listSaved as listChurchSaved,
  loadChatState as loadChurchState,
  openChat as openChurchChat,
  rateChatAnswer as rateChurchAnswer,
  refreshChatState as refreshChurchState,
  renameChat as renameChurchChat,
  saveAnswer as saveChurchAnswer,
} from "@/app/(app)/assistant/actions";
import {
  askQuestion as askPlatform,
  deleteChat as deletePlatformChat,
  listChats as listPlatformChats,
  listSaved as listPlatformSaved,
  loadChatState as loadPlatformState,
  openChat as openPlatformChat,
  rateChatAnswer as ratePlatformAnswer,
  refreshChatState as refreshPlatformState,
  renameChat as renamePlatformChat,
  saveAnswer as savePlatformAnswer,
} from "@/app/superadmin/ask/actions";
import type { Dictionary, PartialDictionary } from "@/lib/i18n/dictionaries/en";
import { makeT } from "@/lib/i18n/translate";
import {
  MAX_CONVERSATION_MESSAGES,
  exchangesOf,
  type ChatAnswer,
  type ChatItem,
  type ConversationDetail,
  type ConversationSummary,
  type SavedAnswer,
} from "@/lib/assistant/shared";
import { useFormat, useOptionalT } from "@/components/i18n-provider";
import { ChatProvider, sourceTitle, type ChatLinks, type ChatScope } from "@/components/assistant/chat-context";
import {
  bumpChat,
  chatMarkdown,
  chatUrl,
  firstParam,
  limitReached,
  markdownFilename,
  tabFromParam,
  type ChatState,
  type ChatTab,
  type LoadChatResult,
} from "@/components/assistant/chat-shared";
import { downloadText } from "@/components/assistant/chat-download";
import { ChatRail, type RailList } from "@/components/assistant/chat-rail";
import { ChatHeader } from "@/components/assistant/chat-header";
import { ChatThread, ThreadSkeleton, type EmptyCopy, type ThreadItem } from "@/components/assistant/chat-thread";
import { ChatComposer, type ComposerBlock } from "@/components/assistant/chat-composer";
import { ChatSaved } from "@/components/assistant/chat-saved";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/*
 * Each shell's actions, behind the same shapes (chat-shared.ts), so this one
 * component serves the church page and /superadmin/ask. Every action decides
 * who is asking for itself; nothing here is trusted to say.
 */
const ACTIONS = {
  church: {
    load: loadChurchState,
    refresh: refreshChurchState,
    ask: askChurch,
    list: listChurchChats,
    open: openChurchChat,
    rename: renameChurchChat,
    remove: deleteChurchChat,
    save: saveChurchAnswer,
    listSaved: listChurchSaved,
    rate: rateChurchAnswer,
  },
  platform: {
    load: loadPlatformState,
    refresh: refreshPlatformState,
    ask: askPlatform,
    list: listPlatformChats,
    open: openPlatformChat,
    rename: renamePlatformChat,
    remove: deletePlatformChat,
    save: savePlatformAnswer,
    listSaved: listPlatformSaved,
    rate: ratePlatformAnswer,
  },
} as const;

/** The superadmin shell has no I18nProvider: it passes the two English sections this page reads. */
export type ChatStrings = {
  assistant: Dictionary["assistant"];
  assistantPage: Dictionary["assistantPage"];
};

/**
 * What the empty chat says and offers, when the shell's own words fit better
 * than the church page's: the platform advisor is about the platform's
 * figures, not a church's attendance.
 */
export type ChatCopy = {
  introAdvisor: string;
  introHelp: string;
  suggestionsAdvisor: string[];
  suggestionsHelp: string[];
};

/** The header is re-read on returning to the tab, at most this often: it is free, but not worth a request per glance. */
const REFRESH_EVERY_MS = 60_000;

function listOf<T>(page: { items: T[]; nextCursor: string | null } | null | undefined): RailList<T> {
  return { items: page?.items ?? [], nextCursor: page?.nextCursor ?? null, loading: false, error: null };
}

function withoutDuplicates<T>(existing: readonly T[], more: readonly T[], key: (x: T) => string): T[] {
  const seen = new Set(existing.map(key));
  return [...existing, ...more.filter((x) => !seen.has(key(x)))];
}

/**
 * The assistant's page: the history on the left (an overlay on a phone), the
 * open chat or the saved answers in the middle, and the composer under them.
 *
 * Its state lives in the URL as well as here (?c=<chat>, ?tab=saved), so a
 * chat can be linked to and a reload lands on it. The server page loads what
 * the URL names before the first paint; after that the page moves between
 * chats with the history API, without reloading, and Back and Forward work.
 *
 * Every state says which state it is: a load that failed says so with Retry,
 * a refused question says why in a red row and keeps the text, AI being off
 * or an allowance being used replaces the composer with the reason and what
 * to do about it, and a full chat offers a new one. None of them is an empty
 * screen.
 */
export function ChatWorkspace({
  scope,
  initial,
  initialTab,
  links,
  strings,
  copy,
}: {
  scope: ChatScope;
  /** loadChatState's answer for this request's URL, from the server page. */
  initial: LoadChatResult;
  initialTab: ChatTab;
  links: ChatLinks;
  strings?: ChatStrings;
  copy?: ChatCopy;
}) {
  const actions = ACTIONS[scope];
  const shellT = useOptionalT();
  const t = useMemo(() => (strings ? makeT("en", strings as PartialDictionary) : shellT), [strings, shellT]);
  const f = useFormat();
  const ctx = useMemo(() => ({ t, scope, links }), [t, scope, links]);

  const opened = initial.ok ? initial.opened : null;
  const [bootError, setBootError] = useState<string | null>(initial.ok ? null : initial.error);
  const [booting, setBooting] = useState(false);
  const [state, setState] = useState<ChatState | null>(initial.ok ? initial.state : null);
  const [chats, setChats] = useState<RailList<ConversationSummary>>(listOf(initial.ok ? initial.chats : null));
  const [saved, setSaved] = useState<RailList<SavedAnswer> | null>(
    initial.ok && initial.saved ? listOf(initial.saved) : null,
  );
  const [tab, setTab] = useState<ChatTab>(initialTab);
  const [conversation, setConversation] = useState<ConversationDetail | null>(opened?.conversation ?? null);
  const [items, setItems] = useState<ThreadItem[]>(opened?.items ?? []);
  const [full, setFull] = useState(opened?.conversation.full ?? false);
  const [notice, setNotice] = useState<string | null>(
    initial.ok && initial.missing ? t("assistantPage.chatNotFound") : null,
  );
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<{ id: string; error: string } | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [rated, setRated] = useState<Record<string, "thanks" | "sorry">>({});
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // What the thread's live region says once an answer lands, for someone who cannot see it arrive.
  const [announcement, setAnnouncement] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  // Local ids for rows that have no database row yet (the pending question, refusals).
  const seq = useRef(0);
  // Only the latest "open this chat" may land: a slow answer for one tapped earlier is dropped.
  const openSeq = useRef(0);
  const scrolledOnce = useRef(false);
  const refreshedAt = useRef(0);

  function localId(prefix: string) {
    seq.current += 1;
    return `${prefix}-${seq.current}`;
  }

  /* ------------------------------------------------------------ *
   * The URL
   * ------------------------------------------------------------ */

  function setUrl(next: { conversationId: string | null; tab: ChatTab }, replace = false) {
    const url = chatUrl(links.base, next);
    if (url === window.location.pathname + window.location.search) return;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }

  // The URL named a chat that is not in this person's history: say so once, and stop naming it.
  const initiallyMissing = initial.ok && initial.missing;
  useEffect(() => {
    if (initiallyMissing) window.history.replaceState(null, "", links.base);
  }, [initiallyMissing, links.base]);

  /*
   * Back and Forward. The history entries are ours (pushState), so the page
   * does not reload; it follows the URL here instead. Read through a ref so
   * the listener, added once, always calls the current handlers.
   *
   * While a question is with the model the screen stays on it (moving away
   * would lose sight of the answer), so a Back or Forward pressed then is
   * remembered and followed the moment the answer has landed: the screen
   * catches up with the URL, rather than the URL being overwritten to match
   * the screen.
   */
  const followUrl = useRef<() => void>(() => {});
  const missedMove = useRef(false);
  useEffect(() => {
    followUrl.current = () => {
      if (sending) {
        missedMove.current = true;
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const nextTab = tabFromParam(params.get("tab"));
      if (nextTab === "saved") {
        showSaved({ url: false });
        return;
      }
      const id = firstParam(params.get("c"));
      if (id) void openChat(id, { url: false });
      else startNew({ url: false });
    };
  });
  useEffect(() => {
    const onPop = () => followUrl.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Declared after the effect that refreshes followUrl, so it calls the handlers that see sending as false.
  useEffect(() => {
    if (sending || !missedMove.current) return;
    missedMove.current = false;
    followUrl.current();
  }, [sending]);

  /*
   * The header again on coming back to the tab: the day's allowance resets at
   * midnight, and an owner may have switched AI on in another tab. Read-only
   * and free, and at most once a minute.
   */
  const refreshState = useRef<() => void>(() => {});
  useEffect(() => {
    refreshState.current = () => {
      if (sending || bootError) return;
      const now = Date.now();
      if (now - refreshedAt.current < REFRESH_EVERY_MS) return;
      refreshedAt.current = now;
      actions.refresh().then(
        (res) => {
          if (res.ok) setState(res.state);
        },
        // Nothing on screen depends on it: the header keeps what it had, and the next question refreshes it.
        (e: unknown) => console.error("[assistant] could not refresh the header", e),
      );
    };
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshState.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /* ------------------------------------------------------------ *
   * Scrolling
   * ------------------------------------------------------------ */

  // To the newest row after every change, instantly the first time (a reload lands at the end, not a slide).
  useEffect(() => {
    if (tab !== "chats" || (items.length === 0 && !sending)) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: scrolledOnce.current ? "smooth" : "auto" });
    scrolledOnce.current = true;
  }, [items, sending, tab]);

  /** Scrolls to an element once the overlay, if it was open, has finished closing and released the page. */
  function scrollToId(id: string, afterOverlay: boolean) {
    const go = () => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (afterOverlay) setTimeout(go, 300);
    else requestAnimationFrame(go);
  }

  /* ------------------------------------------------------------ *
   * Moving between chats
   * ------------------------------------------------------------ */

  function startNew({ url = true }: { url?: boolean } = {}) {
    if (sending) return;
    openSeq.current += 1;
    setOpening(false);
    setOpenError(null);
    setConversation(null);
    setItems([]);
    setFull(false);
    setRated({});
    setTab("chats");
    setHistoryOpen(false);
    setNotice(null);
    scrolledOnce.current = false;
    if (url) setUrl({ conversationId: null, tab: "chats" });
  }

  async function openChat(id: string, { url = true }: { url?: boolean } = {}) {
    if (sending) return;
    setHistoryOpen(false);
    setTab("chats");
    setNotice(null);
    if (url) setUrl({ conversationId: id, tab: "chats" });
    if (conversation?.id === id && !openError) {
      // Already on screen: drop any slower open still on its way.
      openSeq.current += 1;
      setOpening(false);
      return;
    }

    openSeq.current += 1;
    const mine = openSeq.current;
    setOpenError(null);
    setOpening(true);
    try {
      const res = await actions.open({ conversationId: id });
      if (mine !== openSeq.current) return;
      if (!res.ok) {
        if (res.missing) {
          // Deleted elsewhere, or never theirs: out of the list, and back to a new chat with the reason.
          setChats((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) }));
          startNew({ url: false });
          setUrl({ conversationId: null, tab: "chats" }, true);
          setNotice(res.error);
          return;
        }
        setOpenError({ id, error: res.error });
        return;
      }
      scrolledOnce.current = false;
      setConversation(res.conversation);
      setItems(res.items);
      setFull(res.conversation.full);
      setRated({});
    } catch (e) {
      console.error("[assistant] could not open the chat", e);
      if (mine === openSeq.current) setOpenError({ id, error: t("assistantPage.chatFailed") });
    } finally {
      if (mine === openSeq.current) setOpening(false);
    }
  }

  function showSaved({ url = true }: { url?: boolean } = {}) {
    setTab("saved");
    setNotice(null);
    if (url) setUrl({ conversationId: null, tab: "saved" });
    if (saved === null) void loadSaved(null);
  }

  /*
   * Only the view changes: on a phone the tabs are inside the History
   * overlay, and switching lists there must leave it open to pick from.
   */
  function switchTab(next: ChatTab) {
    if (next === tab) return;
    if (next === "saved") {
      showSaved();
      return;
    }
    setTab("chats");
    setUrl({ conversationId: conversation?.id ?? null, tab: "chats" });
  }

  function openSaved(s: SavedAnswer) {
    const wasOpen = historyOpen;
    setHistoryOpen(false);
    if (tab !== "saved") showSaved();
    scrollToId(`saved-${s.answer.id}`, wasOpen);
  }

  /* ------------------------------------------------------------ *
   * Paging the lists
   * ------------------------------------------------------------ */

  async function moreChats() {
    if (chats.loading) return;
    const cursor = chats.nextCursor;
    setChats((c) => ({ ...c, loading: true, error: null }));
    try {
      const res = await actions.list({ cursor });
      if (!res.ok) {
        setChats((c) => ({ ...c, loading: false, error: res.error }));
        return;
      }
      setChats((c) => ({
        items: cursor ? withoutDuplicates(c.items, res.items, (x) => x.id) : res.items,
        nextCursor: res.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (e) {
      console.error("[assistant] could not load more chats", e);
      setChats((c) => ({ ...c, loading: false, error: t("assistantPage.listFailed") }));
    }
  }

  async function loadSaved(cursor: string | null) {
    setSaved((s) => ({ items: s?.items ?? [], nextCursor: s?.nextCursor ?? null, loading: true, error: null }));
    try {
      const res = await actions.listSaved({ cursor });
      if (!res.ok) {
        setSaved((s) => ({ ...(s ?? listOf<SavedAnswer>(null)), loading: false, error: res.error }));
        return;
      }
      setSaved((s) => ({
        items: cursor ? withoutDuplicates(s?.items ?? [], res.items, (x) => x.answer.id) : res.items,
        nextCursor: res.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (e) {
      console.error("[assistant] could not load saved answers", e);
      setSaved((s) => ({ ...(s ?? listOf<SavedAnswer>(null)), loading: false, error: t("assistantPage.listFailed") }));
    }
  }

  function moreSaved() {
    if (saved?.loading) return;
    void loadSaved(saved?.nextCursor ?? null);
  }

  /* ------------------------------------------------------------ *
   * Asking
   * ------------------------------------------------------------ */

  async function send(raw: string) {
    const q = raw.trim();
    if (!q || sending || !state) return;
    const pendingId = localId("pending");
    const askedIn = conversation?.id ?? null;
    // Where the page was when the question went. The answer may move the URL only if nobody has moved it since.
    const urlAtSend = window.location.pathname + window.location.search;
    setItems((xs) => [...xs.filter((x) => x.role !== "error"), { role: "pending", id: pendingId, content: q }]);
    setText("");
    setNotice(null);
    setAnnouncement("");
    setSending(true);
    try {
      const res = await actions.ask({ conversationId: askedIn, text: q });
      if (res.ok) {
        const at = res.answer.createdAt;
        /*
         * The server starts a new conversation when the one asked in is gone
         * (deleted in another tab, or on a phone). That one's thread and
         * count are not this one's: the answer starts the thread afresh, the
         * old chat leaves the list, and the notice says what happened.
         */
        const restarted = askedIn !== null && res.conversationId !== askedIn;
        setState(res.state);
        // The stored question replaces what was typed: what is shown is what was sent, placeholders and all.
        setItems((xs) =>
          restarted ? [res.question, res.answer] : [...xs.filter((x) => x.id !== pendingId), res.question, res.answer],
        );
        // Nothing usable came back: the question goes back in the box, so asking again is one press.
        if (res.answer.kind === "failed") setText(q);
        setAnnouncement(t("assistantPage.answerReady"));
        if (restarted) {
          setRated({});
          setNotice(t("assistantPage.chatRestarted"));
        }
        const count = (askedIn && !restarted && conversation ? conversation.messageCount : 0) + 2;
        const isFull = count + 2 > MAX_CONVERSATION_MESSAGES;
        setConversation((c) =>
          c && c.id === res.conversationId
            ? { ...c, title: res.title, messageCount: count, full: isFull, lastMessageAt: at }
            : {
                id: res.conversationId,
                title: res.title,
                messageCount: count,
                full: isFull,
                locale: t.locale,
                startedAt: at,
                lastMessageAt: at,
                contextChurch: null,
              },
        );
        setFull(isFull);
        setChats((c) => ({
          ...c,
          items: bumpChat(restarted ? c.items.filter((i) => i.id !== askedIn) : c.items, {
            id: res.conversationId,
            title: res.title,
            lastMessageAt: at,
            addMessages: 2,
          }),
        }));
        /*
         * A new chat has an address from its first answer on; replaced, so
         * Back does not return to a blank one. Only while the URL is still
         * where the question was asked: after a move to Saved, or a Back
         * press, replacing it would overwrite the entry the person went to.
         * The chat keeps its new id either way, and returning to it writes it.
         */
        if (res.conversationId !== askedIn && window.location.pathname + window.location.search === urlAtSend) {
          setUrl({ conversationId: res.conversationId, tab: "chats" }, true);
        }
        return;
      }
      setItems((xs) => xs.filter((x) => x.id !== pendingId));
      setText(q);
      if (res.state) setState(res.state);
      if (res.code === "conversationFull") setFull(true);
      // When the header now explains it (AI off, an allowance used), a red row would only say it twice.
      const explained = res.state && (res.state.dormant || limitReached(res.state.usage));
      if (!explained && res.code !== "conversationFull") {
        setItems((xs) => [...xs, { role: "error", id: localId("error"), content: res.error }]);
      }
    } catch (e) {
      console.error("[assistant] the question could not be sent", e);
      setItems((xs) => [
        ...xs.filter((x) => x.id !== pendingId),
        { role: "error", id: localId("error"), content: t("assistant.failed") },
      ]);
      setText(q);
    } finally {
      setSending(false);
    }
  }

  /* ------------------------------------------------------------ *
   * Answers: feedback and saving
   * ------------------------------------------------------------ */

  /** One answer changed, wherever it is shown: in the open chat and on the Saved tab. */
  function patchAnswer(id: string, patch: (a: ChatAnswer) => ChatAnswer) {
    setItems((xs) => xs.map((x) => (x.role === "assistant" && x.id === id ? patch(x) : x)));
    setSaved((s) =>
      s ? { ...s, items: s.items.map((x) => (x.answer.id === id ? { ...x, answer: patch(x.answer) } : x)) } : s,
    );
  }

  async function rate(id: string, helpful: boolean) {
    const previous =
      items.find((x): x is ChatAnswer => x.role === "assistant" && x.id === id)?.helpful ??
      saved?.items.find((x) => x.answer.id === id)?.answer.helpful ??
      null;
    const undo = (message: string) => {
      patchAnswer(id, (a) => ({ ...a, helpful: previous }));
      setRated((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      toast.error(message);
    };
    setRated((r) => ({ ...r, [id]: helpful ? "thanks" : "sorry" }));
    patchAnswer(id, (a) => ({ ...a, helpful }));
    try {
      const res = await actions.rate({ messageId: id, helpful });
      if (!res.ok) undo(res.error);
    } catch (e) {
      console.error("[assistant] feedback failed", e);
      undo(t("assistant.feedbackFailed"));
    }
  }

  async function save(answer: ChatAnswer, next: boolean) {
    const fromSaved = saved?.items.find((x) => x.answer.id === answer.id);
    const conversationId = fromSaved?.conversationId ?? conversation?.id ?? null;
    setSavingIds((s) => new Set(s).add(answer.id));
    try {
      const res = await actions.save({ messageId: answer.id, saved: next });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      patchAnswer(answer.id, (a) => ({ ...a, savedAt: res.savedAt }));
      if (conversationId) {
        setChats((c) => ({
          ...c,
          items: c.items.map((i) =>
            i.id === conversationId ? { ...i, savedCount: Math.max(0, i.savedCount + (next ? 1 : -1)) } : i,
          ),
        }));
      }
      // Saved from the chat while the Saved tab is loaded: it belongs at the top of that list now.
      if (next && !fromSaved && conversation && saved) {
        const question = exchangesOf(items.filter((x): x is ChatItem => x.role === "user" || x.role === "assistant"))
          .find((x) => x.answer.id === answer.id)?.question ?? null;
        const entry: SavedAnswer = {
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          question,
          answer: { ...answer, savedAt: res.savedAt },
        };
        setSaved((s) => (s ? { ...s, items: [entry, ...s.items.filter((x) => x.answer.id !== answer.id)] } : s));
      }
    } catch (e) {
      console.error("[assistant] save failed", e);
      toast.error(t("assistantPage.saveFailed"));
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(answer.id);
        return n;
      });
    }
  }

  /* ------------------------------------------------------------ *
   * The chat's menu
   * ------------------------------------------------------------ */

  /** Renames the chat the edit was started on, which is not always the one open by the time it is saved. */
  async function rename(id: string, title: string): Promise<boolean> {
    try {
      const res = await actions.rename({ conversationId: id, title });
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      setConversation((c) => (c && c.id === id ? { ...c, title: res.title } : c));
      setChats((c) => ({ ...c, items: c.items.map((i) => (i.id === id ? { ...i, title: res.title } : i)) }));
      setSaved((s) =>
        s
          ? { ...s, items: s.items.map((x) => (x.conversationId === id ? { ...x, conversationTitle: res.title } : x)) }
          : s,
      );
      return true;
    } catch (e) {
      console.error("[assistant] rename failed", e);
      toast.error(t("assistantPage.renameFailed"));
      return false;
    }
  }

  async function confirmDelete() {
    if (!conversation) return;
    const id = conversation.id;
    setDeleting(true);
    try {
      const res = await actions.remove({ conversationId: id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setChats((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) }));
      setSaved((s) => (s ? { ...s, items: s.items.filter((x) => x.conversationId !== id) } : s));
      setDeleteOpen(false);
      startNew();
      toast.success(t("assistantPage.deleted"));
    } catch (e) {
      console.error("[assistant] delete failed", e);
      toast.error(t("assistantPage.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  function downloadChatMarkdown() {
    if (!conversation) return;
    const stored = items.filter((x): x is ChatItem => x.role === "user" || x.role === "assistant");
    const body = chatMarkdown({
      title: conversation.title || t("assistantPage.untitled"),
      exchanges: exchangesOf(stored),
      labels: {
        question: t("assistantPage.question"),
        answer: t("assistantPage.answer"),
        sources: t("assistantPage.sources"),
        sourceTitle: (s) => sourceTitle(t, s),
        leftOut: (count) => t("assistantPage.answersLeftOut", { count }),
      },
    });
    downloadText(body, markdownFilename(new Date()));
  }

  /* ------------------------------------------------------------ *
   * A first load that failed
   * ------------------------------------------------------------ */

  async function retryBoot() {
    setBooting(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const res = await actions.load({ conversationId: firstParam(params.get("c")), tab: params.get("tab") });
      if (!res.ok) {
        setBootError(res.error);
        return;
      }
      setState(res.state);
      setChats(listOf(res.chats));
      setSaved(res.saved ? listOf(res.saved) : null);
      setConversation(res.opened?.conversation ?? null);
      setItems(res.opened?.items ?? []);
      setFull(res.opened?.conversation.full ?? false);
      setNotice(res.missing ? t("assistantPage.chatNotFound") : null);
      setBootError(null);
    } catch (e) {
      console.error("[assistant] could not load the page", e);
      setBootError(t("assistantPage.loadFailed"));
    } finally {
      setBooting(false);
    }
  }

  /* ------------------------------------------------------------ *
   * Drawing
   * ------------------------------------------------------------ */

  const church = scope === "church";
  const shell = cn(
    "flex flex-col lg:flex-row lg:overflow-hidden",
    church
      ? // Full-bleed under the church top bar; on a desktop it stays put while the page is scrolled past a banner.
        "max-lg:min-h-[calc(100dvh-10rem-env(safe-area-inset-top))] lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)]"
      : // Inside the admin shell's padded column: edge to edge on a phone, a framed card from lg up.
        "-mx-4 -my-6 max-lg:min-h-[calc(100dvh-3.5rem)] lg:mx-0 lg:my-0 lg:h-[calc(100dvh-6.5rem)] lg:rounded-2xl lg:border",
  );

  if (bootError || !state) {
    return (
      <ChatProvider value={ctx}>
        <div className="mx-auto max-w-xl px-4 py-10">
          <div className="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm" role="alert">
            <p>{bootError ?? t("assistantPage.loadFailed")}</p>
            <Button variant="outline" onClick={() => void retryBoot()} disabled={booting}>
              {booting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              {t("assistant.retry")}
            </Button>
          </div>
        </div>
      </ChatProvider>
    );
  }

  const limit = limitReached(state.usage);
  const monthly = state.usage.monthly;
  const block: ComposerBlock | null = state.dormant
    ? { kind: "dormant", text: state.dormant }
    : limit === "monthly" && monthly && monthly.limit !== null
      ? {
          kind: "limit",
          period: "monthly",
          text: t("assistantPage.monthlyLimit", { max: monthly.limit }),
          resets: state.usage.resetsAt.month ? t("assistantPage.resetsOn", { date: f.date(state.usage.resetsAt.month) }) : "",
          upgrade: links.upgrade,
        }
      : limit === "daily"
        ? {
            kind: "limit",
            period: "daily",
            text: t("assistantPage.dailyLimit", { max: state.usage.daily.limit }),
            resets: t("assistantPage.resetsOn", { date: f.dateTime(state.usage.resetsAt.day) }),
            upgrade: null,
          }
        : full
          ? { kind: "full" }
          : null;

  const empty: EmptyCopy =
    state.usage.mode === "advisor"
      ? {
          intro: copy?.introAdvisor ?? t("assistantPage.introAdvisor"),
          suggestions: copy?.suggestionsAdvisor ?? [
            t("assistantPage.suggestionTrend"),
            t("assistantPage.suggestionFirstTimers"),
            t("assistantPage.suggestionGiving"),
            t("assistantPage.suggestionRecord"),
          ],
        }
      : {
          intro: copy?.introHelp ?? t("assistant.intro"),
          suggestions: copy?.suggestionsHelp ?? [
            t("assistant.suggestionSms"),
            t("assistant.suggestionImport"),
            t("assistant.suggestionAttendance"),
            t("assistantPage.suggestionFollowUp"),
          ],
        };

  const rail = (
    <ChatRail
      tab={tab}
      onTab={switchTab}
      query={query}
      onQuery={setQuery}
      chats={chats}
      onMoreChats={() => void moreChats()}
      saved={saved}
      onMoreSaved={moreSaved}
      activeId={tab === "chats" ? (conversation?.id ?? null) : null}
      onOpen={(id) => void openChat(id)}
      onOpenSaved={openSaved}
      onNewChat={() => startNew()}
      busy={sending}
    />
  );

  return (
    <ChatProvider value={ctx}>
      <div className={shell}>
        <aside className="hidden w-72 shrink-0 flex-col border-r lg:flex" aria-label={t("assistantPage.history")}>
          {rail}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "bg-background z-20 border-b px-4 py-2 lg:static lg:px-6 lg:py-3",
              church ? "sticky top-[calc(env(safe-area-inset-top)+4rem)]" : "sticky top-14 lg:rounded-tr-2xl",
            )}
          >
            <div className="mx-auto max-w-3xl">
              {/* Keyed by the chat, so a rename begun in one chat never survives a switch to another. */}
              <ChatHeader
                key={conversation?.id ?? "new"}
                state={state}
                title={conversation ? conversation.title || t("assistantPage.untitled") : null}
                conversationId={conversation?.id ?? null}
                savedView={tab === "saved"}
                busy={sending}
                onOpenHistory={() => setHistoryOpen(true)}
                onNewChat={() => startNew()}
                onRename={rename}
                onDownloadMarkdown={downloadChatMarkdown}
                onDelete={() => setDeleteOpen(true)}
              />
            </div>
          </div>

          <div className="flex-1 px-4 py-4 lg:min-h-0 lg:overflow-y-auto lg:px-6 lg:py-6">
            <div className="mx-auto max-w-3xl space-y-4">
              {notice && (
                <div className="flex items-start gap-2 rounded-xl border bg-amber-500/10 p-3 text-sm" role="status">
                  <p className="min-w-0 flex-1">{notice}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-my-1.5 -mr-1.5"
                    onClick={() => setNotice(null)}
                    aria-label={t("assistantPage.dismiss")}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}

              {tab === "saved" ? (
                <ChatSaved
                  saved={saved}
                  query={query}
                  onMore={moreSaved}
                  onOpenChat={(id) => void openChat(id)}
                  busy={sending}
                  rated={rated}
                  onRate={(id, helpful) => void rate(id, helpful)}
                  onSave={(a, next) => void save(a, next)}
                  savingIds={savingIds}
                />
              ) : opening ? (
                <ThreadSkeleton />
              ) : openError ? (
                <div className="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm" role="alert">
                  <p>{openError.error}</p>
                  <Button variant="outline" onClick={() => void openChat(openError.id, { url: false })}>
                    <RotateCcw className="size-4" />
                    {t("assistant.retry")}
                  </Button>
                </div>
              ) : (
                <ChatThread
                  ref={endRef}
                  items={items}
                  mode={state.usage.mode}
                  sending={sending}
                  announcement={announcement}
                  empty={empty}
                  canAsk={!block}
                  onSuggestion={(q) => void send(q)}
                  conversationId={conversation?.id ?? null}
                  conversationTitle={conversation?.title ?? ""}
                  rated={rated}
                  onRate={(id, helpful) => void rate(id, helpful)}
                  onSave={(a, next) => void save(a, next)}
                  savingIds={savingIds}
                />
              )}
            </div>
          </div>

          {tab === "chats" && !openError && (
            <div
              className={cn(
                "bg-background z-20 border-t px-4 pt-3 lg:static lg:px-6 lg:pb-4",
                church
                  ? // Above the phone's bottom bar, which already pads for the home indicator.
                    "sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] pb-3"
                  : "sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:rounded-br-2xl",
              )}
            >
              <div className="mx-auto max-w-3xl">
                <ChatComposer
                  text={text}
                  onText={setText}
                  onSend={() => void send(text)}
                  sending={sending}
                  disabled={opening}
                  block={block}
                  onNewChat={() => startNew()}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {/*
        The history on a phone: full screen, through Radix's portal to
        document.body. Rendered inside the sticky header it would resolve
        against that header (AGENTS.md: backdrop-filter and fixed children).
      */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent
          className="top-0 left-0 h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-h-dvh sm:max-w-sm sm:border-r lg:hidden"
          aria-describedby={undefined}
        >
          <DialogTitle className="border-b px-4 py-3.5 pr-14 text-base">{t("assistantPage.history")}</DialogTitle>
          <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{rail}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("assistantPage.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("assistantPage.deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t("assistantPage.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t("assistantPage.deleteChat")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChatProvider>
  );
}
