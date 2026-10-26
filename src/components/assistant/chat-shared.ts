/**
 * The chat page's pure half: the shapes its server actions answer in (the same
 * in the church shell and the superadmin shell, so one client component serves
 * both), and the small rules the page follows that are worth pinning in a test
 * rather than reading off a screen: the Markdown a download contains, what a
 * file is called, which allowance has run out, and what the history search
 * matches.
 *
 * Client-safe and database-free. The action files import its types, and
 * limitReached so the header note and the composer agree on when nothing can
 * be asked.
 */
import type { ChatUsage } from "@/lib/assistant/advisor-shared";
import type { TKey } from "@/lib/i18n/translate";
import type {
  AssistantErrorCode,
  AssistantSource,
  ChatAnswer,
  ChatItem,
  ChatQuestion,
  ConversationDetail,
  ConversationSummary,
  SavedAnswer,
} from "@/lib/assistant/shared";

/**
 * The page header's facts, with the two sentences that need the server to
 * write them: why answers are not using figures right now, and why nothing can
 * be asked at all. Both are already in the reader's language (or, in the
 * superadmin shell, in English with runAi's own explanation).
 */
export type ChatState = {
  usage: ChatUsage;
  /** Set only while answers come from the guides because the advisor is unavailable. */
  advisorNote: string | null;
  /** Set when AI cannot run at all right now: the composer is replaced by this. */
  dormant: string | null;
};

export type ChatPage<T> = { items: T[]; nextCursor: string | null };

export type OpenedChat = { conversation: ConversationDetail; items: ChatItem[] };

/** Everything the page needs to draw itself, in one call: the server page uses it, and so does Retry. */
export type LoadChatResult =
  | {
      ok: true;
      state: ChatState;
      chats: ChatPage<ConversationSummary>;
      /** The conversation the URL named, when it is this person's. */
      opened: OpenedChat | null;
      /** The URL named a conversation that is not (or no longer) in this person's history. */
      missing: boolean;
      /** The first page of saved answers, loaded only when the page opens on that tab. */
      saved: ChatPage<SavedAnswer> | null;
    }
  | { ok: false; error: string };

export type AskChatResult =
  | {
      ok: true;
      conversationId: string;
      title: string;
      question: ChatQuestion;
      answer: ChatAnswer;
      state: ChatState;
    }
  | {
      ok: false;
      /** "plan" is the church's plan refusing the feature, before the core is asked. */
      code: AssistantErrorCode | "plan";
      /** Already translated. */
      error: string;
      /** Fresh header facts when they are what changed (an allowance ran out, AI went off). */
      state: ChatState | null;
    };

export type ActionError = { ok: false; error: string };
export type ChatListResult = ({ ok: true } & ChatPage<ConversationSummary>) | ActionError;
export type SavedListResult = ({ ok: true } & ChatPage<SavedAnswer>) | ActionError;
export type OpenChatResult = ({ ok: true } & OpenedChat) | (ActionError & { missing?: boolean });
export type RenameChatResult = { ok: true; title: string } | ActionError;
export type SaveAnswerResult = { ok: true; savedAt: string | null } | ActionError;
export type ChatStateResult = { ok: true; state: ChatState } | ActionError;
export type PlainResult = { ok: true } | ActionError;

/** The page's tabs, as the URL spells them (?tab=saved; chats is the default and is left out). */
export type ChatTab = "chats" | "saved";

export function tabFromParam(value: string | string[] | null | undefined): ChatTab {
  return value === "saved" ? "saved" : "chats";
}

/** One value from a search param, or null: Next hands over an array when a key repeats. */
export function firstParam(value: string | string[] | null | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : null;
}

/**
 * The address for the page's state, so a chat is linkable and a reload lands
 * on it: `?c=<id>` for a chat, `?tab=saved` for the saved answers, and nothing
 * at all for a new chat.
 */
export function chatUrl(base: string, state: { conversationId: string | null; tab: ChatTab }): string {
  const params = new URLSearchParams();
  if (state.tab === "saved") params.set("tab", "saved");
  else if (state.conversationId) params.set("c", state.conversationId);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

/** The PDF of a whole chat, or of one answer in it. The route checks ownership again. */
export function pdfHref(exportBase: string, conversationId: string, messageId?: string): string {
  const params = new URLSearchParams({ c: conversationId, format: "pdf" });
  if (messageId) params.set("m", messageId);
  return `${exportBase}?${params.toString()}`;
}

/** Why a PDF did not arrive. One cause per value, so the page can say which, and what to do about it. */
export type PdfFailure = "tooMany" | "withheld" | "notFound" | "failed" | "offline" | "signedOut";

/** The sentence for each cause. notFound is the same thing the chat list says about a chat that is gone. */
export const PDF_FAILURE_KEY: Record<PdfFailure, TKey> = {
  tooMany: "assistantPage.pdfTooMany",
  withheld: "assistantPage.pdfWithheld",
  notFound: "assistantPage.chatNotFound",
  failed: "assistantPage.pdfFailed",
  offline: "assistantPage.pdfOffline",
  signedOut: "assistantPage.pdfSignedOut",
};

/**
 * What the export route's reply means, or null when it is the PDF. The route
 * answers each refusal with its own status (429 too many, 403 figures the
 * role no longer includes, 404 not this person's). A reply that is not a PDF
 * is never saved as one, even with a 200: an ended session is redirected to
 * the sign-in page, and fetch follows the redirect and hands back its HTML.
 */
export function pdfOutcome(reply: { status: number; contentType: string | null; redirected: boolean }): PdfFailure | null {
  if (reply.status === 429) return "tooMany";
  if (reply.status === 403) return "withheld";
  if (reply.status === 404) return "notFound";
  if (reply.status < 200 || reply.status >= 300) return "failed";
  if ((reply.contentType ?? "").toLowerCase().startsWith("application/pdf")) return null;
  return reply.redirected ? "signedOut" : "failed";
}

/** The file name a Content-Disposition header gives, or null unless it is a plain name (never a path). */
export function filenameFromDisposition(header: string | null): string | null {
  const m = header ? (/filename="([^"]*)"/i.exec(header) ?? /filename=([^;\s]+)/i.exec(header)) : null;
  const name = m?.[1]?.trim() ?? "";
  return /^[\w][\w.-]*$/.test(name) ? name : null;
}

/** The same name the PDF route gives its file, with the Markdown extension. */
export function markdownFilename(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `flockinsight-assistant-${y}-${m}-${d}.md`;
}

/**
 * Which allowance has run out, if one has: the month first, because it is the
 * one waiting until tomorrow does not fix. A null limit is no ceiling.
 */
export function limitReached(usage: ChatUsage): "monthly" | "daily" | null {
  if (usage.monthly && usage.monthly.limit !== null && usage.monthly.used >= usage.monthly.limit) {
    return "monthly";
  }
  if (usage.daily.used >= usage.daily.limit) return "daily";
  return null;
}

/** Lower-case, accents folded and spaces squeezed, so "réunion" finds "Reunion". */
export function searchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The loaded chats whose title holds every word of the search, in order of the list. */
export function filterChats<T extends { title: string }>(items: readonly T[], query: string): T[] {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((i) => {
    const title = searchKey(i.title);
    return words.every((w) => title.includes(w));
  });
}

/** The same for saved answers, which match on the question as well as the chat's title. */
export function filterSaved(items: readonly SavedAnswer[], query: string): SavedAnswer[] {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((s) => {
    const text = searchKey(`${s.conversationTitle} ${s.question?.content ?? ""}`);
    return words.every((w) => text.includes(w));
  });
}

/**
 * A chat moved to the top of the history after a question, or added there if
 * this was its first. The list is newest first by last message, so the chat
 * just asked in always belongs at the top.
 */
export function bumpChat(
  items: readonly ConversationSummary[],
  next: Pick<ConversationSummary, "id" | "title" | "lastMessageAt"> & { addMessages: number },
): ConversationSummary[] {
  const existing = items.find((i) => i.id === next.id);
  const bumped: ConversationSummary = existing
    ? {
        ...existing,
        title: next.title || existing.title,
        messageCount: existing.messageCount + next.addMessages,
        lastMessageAt: next.lastMessageAt,
      }
    : {
        id: next.id,
        title: next.title,
        messageCount: next.addMessages,
        savedCount: 0,
        startedAt: next.lastMessageAt,
        lastMessageAt: next.lastMessageAt,
      };
  return [bumped, ...items.filter((i) => i.id !== next.id)];
}

/** Words a Markdown download needs, in the reader's language. */
export type MarkdownLabels = {
  question: string;
  answer: string;
  sources: string;
  /** What a source chip says for the figures and for an approved answer. */
  sourceTitle: (s: AssistantSource) => string;
  /** The line saying how many withheld answers were left out, as the PDF says it. */
  leftOut: (count: number) => string;
};

/**
 * A chat, or one answer, as a Markdown file: the title, then each question as
 * a quote and its answer as the model wrote it, with the sources listed as
 * text (a link to /help/... means nothing in a file on somebody's desktop
 * unless the path is written out).
 *
 * A withheld answer (figures this person may no longer read) has no content
 * to write, so its exchange is left out and a line at the end says how many
 * were, the same way the PDF does: a missing answer never reads as no answer.
 */
export function chatMarkdown(input: {
  title: string;
  exchanges: readonly { question: ChatQuestion | null; answer: ChatAnswer }[];
  labels: MarkdownLabels;
}): string {
  const out: string[] = [`# ${oneLine(input.title)}`, ""];
  const kept = input.exchanges.filter((e) => !e.answer.withheld);
  for (const { question, answer } of kept) {
    if (question) {
      out.push(`## ${input.labels.question}`, "");
      for (const line of question.content.replace(/\r\n/g, "\n").split("\n")) out.push(`> ${line}`.trimEnd());
      out.push("");
    }
    out.push(`## ${input.labels.answer}`, "", answer.content.trim(), "");
    if (answer.sources.length > 0) {
      const list = answer.sources.map((s) => {
        const title = input.labels.sourceTitle(s);
        return s.href ? `${title} (${s.href})` : title;
      });
      out.push(`${input.labels.sources}: ${list.join(", ")}`, "");
    }
  }
  const withheld = input.exchanges.length - kept.length;
  if (withheld > 0) out.push(`_${input.labels.leftOut(withheld)}_`, "");
  return `${out.join("\n").trimEnd()}\n`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
