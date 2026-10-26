import "server-only";

import { and, asc, count, desc, eq, inArray, isNotNull, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { assistantConversation, assistantMessage, church } from "@/db/schema";
import { guideTitle } from "@/lib/assistant/grounding";
import { isOnlyPlaceholders } from "@/lib/assistant/scrub";
import { scrubForAsker } from "@/lib/assistant/redact";
import {
  MAX_CONVERSATION_MESSAGES,
  conversationTitle,
  type AnswerKind,
  type AssistantSource,
  type ChatAnswer,
  type ChatItem,
  type ChatQuestion,
  type ConversationDetail,
  type ConversationSummary,
  type SavedAnswer,
} from "@/lib/assistant/shared";
import { FACTS_SOURCE } from "@/lib/assistant/advisor-shared";
import {
  messageChurchMatch,
  ownedConversation,
  ownedConversations,
  ownerOf,
  type AssistantAsker,
  type ChatOwner,
} from "@/lib/assistant/owner";

/*
 * The chat page's reads and small writes: the history list, one
 * conversation, rename, delete, save, and the "Saved" tab.
 *
 * Every function takes the asker and filters through ownedConversations(),
 * the one tenancy predicate (this person, this scope, this church or none,
 * the church an admin was acting as or none, not deleted), and every message
 * read repeats the church predicate on the message row. A foreign or unknown
 * id matches nothing and reads as "not found", never as "not yours".
 *
 * Counts per conversation are separate grouped queries joined in JS, never a
 * correlated raw-sql subquery (AGENTS.md: drizzle drops the qualifier and the
 * count is silently 0).
 *
 * An advisor answer is only ever handed to someone who may read, today, the
 * figures it was written from (mayReadFigures). The advisor only answered
 * people who could, so this bites only when a role was narrowed afterwards;
 * the answer then arrives withheld, with no content, and the page says why.
 * The page, the Saved tab, the Markdown download and the PDF therefore all
 * follow the one rule, and the browser never holds what the PDF would refuse.
 */

const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

/**
 * Whether this person may read, today, the figures advisor answers are
 * written from: the advisor's own gate. canReadChurchSummary for a church
 * role, platform.overview.view for an admin on /superadmin; an admin acting
 * as a church holds every permission.
 */
export function mayReadFigures(asker: AssistantAsker): boolean {
  return asker.kind === "actingAs" ? true : asker.canReadFigures;
}

/** An answer as this person may see it: an advisor answer without its figures when they may not read them. */
function forReader(a: ChatAnswer, may: boolean): ChatAnswer {
  if (may || a.mode !== "advisor") return a;
  return { ...a, content: "", sources: [], figuresOk: null, withheld: true };
}

/** What the page shows for a cited source. The page translates by `ref`; the title is the English fallback. */
export function resolveSources(sources: string[]): AssistantSource[] {
  return sources.map((ref) => {
    if (ref === FACTS_SOURCE) return { ref, title: "Your figures", href: null };
    if (ref.startsWith("guide:")) {
      const slug = ref.slice(6);
      return { ref, title: guideTitle(slug) ?? slug, href: `/help/${slug}` };
    }
    return { ref, title: "Approved answer", href: null };
  });
}

/** The message columns every reader needs, in one place so no reader forgets one. */
export const chatMessageColumns = {
  id: assistantMessage.id,
  conversationId: assistantMessage.conversationId,
  role: assistantMessage.role,
  content: assistantMessage.content,
  redactions: assistantMessage.redactions,
  answerKind: assistantMessage.answerKind,
  sources: assistantMessage.sources,
  helpful: assistantMessage.helpful,
  mode: assistantMessage.mode,
  figuresOk: assistantMessage.figuresOk,
  savedAt: assistantMessage.savedAt,
  createdAt: assistantMessage.createdAt,
};

type MessageRow = {
  id: string;
  role: string;
  content: string;
  redactions: number;
  answerKind: string | null;
  sources: string[] | null;
  helpful: boolean | null;
  mode: string;
  figuresOk: boolean | null;
  savedAt: Date | null;
  createdAt: Date;
};

export function toChatQuestion(r: MessageRow): ChatQuestion {
  return {
    role: "user",
    id: r.id,
    content: r.content,
    redactions: r.redactions,
    mode: r.mode === "advisor" ? "advisor" : "help",
    createdAt: r.createdAt.toISOString(),
  };
}

export function toChatAnswer(r: MessageRow): ChatAnswer {
  return {
    role: "assistant",
    id: r.id,
    content: r.content,
    kind: (r.answerKind ?? "failed") as AnswerKind,
    sources: resolveSources(r.sources ?? []),
    helpful: r.helpful,
    mode: r.mode === "advisor" ? "advisor" : "help",
    figuresOk: r.figuresOk,
    savedAt: r.savedAt ? r.savedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toChatItem(r: MessageRow): ChatItem {
  return r.role === "user" ? toChatQuestion(r) : toChatAnswer(r);
}

/** A conversation's messages, question before answer (both rows of an exchange share one now()). */
export async function conversationMessages(owner: ChatOwner, conversationId: string): Promise<ChatItem[]> {
  const rows = await db
    .select(chatMessageColumns)
    .from(assistantMessage)
    .where(and(eq(assistantMessage.conversationId, conversationId), messageChurchMatch(owner)))
    // "user" sorts after "assistant", so the role order is reversed to keep the question first.
    .orderBy(asc(assistantMessage.createdAt), desc(assistantMessage.role))
    .limit(MAX_CONVERSATION_MESSAGES);
  return rows.map(toChatItem);
}

/* ------------------------------------------------------------------ *
 * Cursors: "<ISO instant>|<uuid>", newest first.
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}

/** Null for anything that is not a cursor this file made: the first page, rather than an error. */
function decodeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = cursor.split("|");
  if (!iso || !id || !UUID.test(id)) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}

function pageSize(limit: number | undefined): number {
  return Math.min(PAGE_MAX, Math.max(1, Math.floor(limit ?? PAGE_DEFAULT)));
}

/*
 * Every timestamp these cursors compare is written by JS (new Date(), whole
 * milliseconds), so an ISO string round-trips it exactly and the equality
 * half of the keyset comparison holds.
 */
function after(
  col: typeof assistantConversation.lastMessageAt | typeof assistantMessage.savedAt,
  idCol: typeof assistantConversation.id | typeof assistantMessage.id,
  c: { at: Date; id: string } | null,
): SQL | undefined {
  if (!c) return undefined;
  return or(lt(col, c.at), and(eq(col, c.at), lt(idCol, c.id)));
}

/* ------------------------------------------------------------------ *
 * The history list
 * ------------------------------------------------------------------ */

/**
 * This person's conversations in this scope, newest first by last message.
 * Pass the previous page's nextCursor for the next page. Deleted
 * conversations are gone from here the moment they are deleted.
 */
export async function listConversations(input: {
  asker: AssistantAsker;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> {
  const owner = ownerOf(input.asker);
  const limit = pageSize(input.limit);
  const rows = await db
    .select({
      id: assistantConversation.id,
      title: assistantConversation.title,
      messageCount: assistantConversation.messageCount,
      startedAt: assistantConversation.startedAt,
      lastMessageAt: assistantConversation.lastMessageAt,
    })
    .from(assistantConversation)
    .where(
      and(
        ownedConversations(owner),
        after(assistantConversation.lastMessageAt, assistantConversation.id, decodeCursor(input.cursor)),
      ),
    )
    .orderBy(desc(assistantConversation.lastMessageAt), desc(assistantConversation.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  if (page.length === 0) return { items: [], nextCursor: null };

  const ids = page.map((r) => r.id);
  const untitled = page.filter((r) => !r.title).map((r) => r.id);
  const [saved, firstQuestions] = await Promise.all([
    db
      .select({ conversationId: assistantMessage.conversationId, n: count() })
      .from(assistantMessage)
      .where(
        and(
          inArray(assistantMessage.conversationId, ids),
          isNotNull(assistantMessage.savedAt),
          messageChurchMatch(owner),
        ),
      )
      .groupBy(assistantMessage.conversationId),
    untitled.length > 0 ? firstQuestionsOf(owner, untitled) : Promise.resolve(new Map<string, string>()),
  ]);
  const savedBy = new Map(saved.map((s) => [s.conversationId, Number(s.n)]));

  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      title: r.title || firstQuestions.get(r.id) || "",
      messageCount: r.messageCount,
      savedCount: savedBy.get(r.id) ?? 0,
      startedAt: r.startedAt.toISOString(),
      lastMessageAt: r.lastMessageAt.toISOString(),
    })),
    nextCursor: more ? encodeCursor(last.lastMessageAt, last.id) : null,
  };
}

/**
 * A title for conversations from before titles existed: their first
 * question. One query for the whole page, the first row per conversation
 * picked in JS.
 */
async function firstQuestionsOf(owner: ChatOwner, conversationIds: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({ conversationId: assistantMessage.conversationId, content: assistantMessage.content })
    .from(assistantMessage)
    .where(
      and(
        inArray(assistantMessage.conversationId, conversationIds),
        eq(assistantMessage.role, "user"),
        messageChurchMatch(owner),
      ),
    )
    .orderBy(asc(assistantMessage.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.conversationId)) out.set(r.conversationId, conversationTitle(r.content));
  return out;
}

/* ------------------------------------------------------------------ *
 * One conversation
 * ------------------------------------------------------------------ */

/** A conversation and its messages, or null when it is not this person's (or not there). */
export async function loadConversation(input: {
  asker: AssistantAsker;
  conversationId: string;
}): Promise<{ conversation: ConversationDetail; items: ChatItem[] } | null> {
  if (!UUID.test(input.conversationId)) return null;
  const owner = ownerOf(input.asker);
  const [conv] = await db
    .select({
      id: assistantConversation.id,
      title: assistantConversation.title,
      messageCount: assistantConversation.messageCount,
      locale: assistantConversation.locale,
      startedAt: assistantConversation.startedAt,
      lastMessageAt: assistantConversation.lastMessageAt,
      contextChurchId: assistantConversation.contextChurchId,
    })
    .from(assistantConversation)
    .where(ownedConversation(owner, input.conversationId))
    .limit(1);
  if (!conv) return null;

  const may = mayReadFigures(input.asker);
  const [items, contextChurch] = await Promise.all([
    conversationMessages(owner, conv.id).then((rows) =>
      rows.map((i) => (i.role === "assistant" ? forReader(i, may) : i)),
    ),
    conv.contextChurchId
      ? db
          .select({ id: church.id, name: church.name })
          .from(church)
          .where(eq(church.id, conv.contextChurchId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const firstQuestion = items.find((i) => i.role === "user");
  return {
    conversation: {
      id: conv.id,
      title: conv.title || (firstQuestion ? conversationTitle(firstQuestion.content) : ""),
      messageCount: conv.messageCount,
      full: conv.messageCount + 2 > MAX_CONVERSATION_MESSAGES,
      locale: conv.locale,
      startedAt: conv.startedAt.toISOString(),
      lastMessageAt: conv.lastMessageAt.toISOString(),
      contextChurch,
    },
    items,
  };
}

/**
 * Renames a conversation. The title is scrubbed exactly like a question,
 * names on the register included (it is stored, and a reviewer reads it in
 * the transcripts), and clipped to 80 characters. A title that scrubs down
 * to nothing but placeholders is refused rather than stored that way.
 */
export async function renameConversation(input: {
  asker: AssistantAsker;
  conversationId: string;
  title: string;
}): Promise<{ ok: true; title: string } | { ok: false }> {
  if (!UUID.test(input.conversationId)) return { ok: false };
  const scrubbed = await scrubForAsker(input.asker, input.title);
  if (isOnlyPlaceholders(scrubbed.text)) return { ok: false };
  const title = conversationTitle(scrubbed.text);
  if (!title) return { ok: false };
  const updated = await db
    .update(assistantConversation)
    .set({ title })
    .where(ownedConversation(ownerOf(input.asker), input.conversationId))
    .returning({ id: assistantConversation.id });
  return updated.length === 1 ? { ok: true, title } : { ok: false };
}

/**
 * Deletes a conversation for this person: hidden at once, saved answers and
 * all, and removed for good by the retention sweep 30 days later. Soft, so a
 * mis-tap is recoverable by support within that window.
 */
export async function deleteConversation(input: {
  asker: AssistantAsker;
  conversationId: string;
}): Promise<{ ok: boolean }> {
  if (!UUID.test(input.conversationId)) return { ok: false };
  const updated = await db
    .update(assistantConversation)
    .set({ deletedAt: new Date() })
    .where(ownedConversation(ownerOf(input.asker), input.conversationId))
    .returning({ id: assistantConversation.id });
  return { ok: updated.length === 1 };
}

/* ------------------------------------------------------------------ *
 * Saved answers
 * ------------------------------------------------------------------ */

/**
 * Saves or unsaves one answer. Only an assistant row in a conversation this
 * person owns; only a real answer can be saved (a "failed" or off-topic reply
 * is not worth keeping past the retention promise), and anything can always
 * be unsaved.
 */
export async function setAnswerSaved(input: {
  asker: AssistantAsker;
  messageId: string;
  saved: boolean;
}): Promise<{ ok: true; savedAt: string | null } | { ok: false }> {
  if (!UUID.test(input.messageId)) return { ok: false };
  const owner = ownerOf(input.asker);
  const [row] = await db
    .select({ id: assistantMessage.id, answerKind: assistantMessage.answerKind })
    .from(assistantMessage)
    .innerJoin(assistantConversation, eq(assistantConversation.id, assistantMessage.conversationId))
    .where(
      and(
        eq(assistantMessage.id, input.messageId),
        eq(assistantMessage.role, "assistant"),
        ownedConversations(owner),
        messageChurchMatch(owner),
      ),
    )
    .limit(1);
  if (!row) return { ok: false };
  if (input.saved && row.answerKind !== "answered") return { ok: false };

  const savedAt = input.saved ? new Date() : null;
  const updated = await db
    .update(assistantMessage)
    .set({ savedAt })
    .where(
      and(eq(assistantMessage.id, row.id), eq(assistantMessage.role, "assistant"), messageChurchMatch(owner)),
    )
    .returning({ id: assistantMessage.id });
  return updated.length === 1 ? { ok: true, savedAt: savedAt ? savedAt.toISOString() : null } : { ok: false };
}

/**
 * The "Saved" tab: this person's saved answers in this scope, most recently
 * saved first, each with the question it answered (the latest question at or
 * before it, picked in JS) and its conversation's title.
 */
export async function listSavedAnswers(input: {
  asker: AssistantAsker;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: SavedAnswer[]; nextCursor: string | null }> {
  const owner = ownerOf(input.asker);
  const limit = pageSize(input.limit);
  const rows = await db
    .select({ ...chatMessageColumns, title: assistantConversation.title })
    .from(assistantMessage)
    .innerJoin(assistantConversation, eq(assistantConversation.id, assistantMessage.conversationId))
    .where(
      and(
        ownedConversations(owner),
        messageChurchMatch(owner),
        eq(assistantMessage.role, "assistant"),
        isNotNull(assistantMessage.savedAt),
        after(assistantMessage.savedAt, assistantMessage.id, decodeCursor(input.cursor)),
      ),
    )
    .orderBy(desc(assistantMessage.savedAt), desc(assistantMessage.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  if (page.length === 0) return { items: [], nextCursor: null };

  const convIds = [...new Set(page.map((r) => r.conversationId))];
  const questions = await db
    .select(chatMessageColumns)
    .from(assistantMessage)
    .where(
      and(
        inArray(assistantMessage.conversationId, convIds),
        eq(assistantMessage.role, "user"),
        messageChurchMatch(owner),
      ),
    )
    .orderBy(asc(assistantMessage.createdAt));
  const byConv = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = byConv.get(q.conversationId) ?? [];
    list.push(q);
    byConv.set(q.conversationId, list);
  }

  const last = page[page.length - 1];
  const may = mayReadFigures(input.asker);
  return {
    items: page.map((r) => {
      const asked = byConv.get(r.conversationId) ?? [];
      let question: (typeof questions)[number] | undefined;
      for (const q of asked) if (q.createdAt.getTime() <= r.createdAt.getTime()) question = q;
      return {
        conversationId: r.conversationId,
        conversationTitle: r.title || (asked[0] ? conversationTitle(asked[0].content) : ""),
        question: question ? toChatQuestion(question) : null,
        answer: forReader(toChatAnswer(r), may),
      };
    }),
    nextCursor: more && last.savedAt ? encodeCursor(last.savedAt, last.id) : null,
  };
}
