import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assistantAnswer,
  assistantConversation,
  assistantMessage,
  member,
} from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { runAi } from "@/lib/ai/run-ai";
import { scrubFreeText } from "@/lib/ai/safe-text";
import { MODELS } from "@/lib/ai/config";
import {
  ASSISTANT_PROMPT_ID,
  ASSISTANT_SYSTEM_PROMPT,
  BURST_LIMIT,
  CHAT_MAX_TOKENS,
  DAILY_QUESTIONS,
  MAX_CONVERSATION_MESSAGES,
  MAX_QUESTION_CHARS,
  answerKindFor,
  buildAssistantUserTurn,
  groundedFromStored,
  historyForModel,
  isModelFailure,
  parseAnswer,
  reviewStatusFor,
  type AnswerKind,
  type AssistantErrorCode,
  type AssistantSource,
  type AssistantThreadItem,
} from "@/lib/assistant/shared";
import { isNameWord, isOnlyPlaceholders, nameCandidates, scrub } from "@/lib/assistant/scrub";
import {
  guideMap,
  guideSlugs,
  guideTitle,
  retrieve,
  type ApprovedAnswer,
} from "@/lib/assistant/grounding";

/**
 * The help assistant's server core, shared by the church shell and the
 * superadmin shell. It returns CODES, never sentences: the church action
 * translates them with getT(), the superadmin action with englishT(en), so a
 * French cookie never leaks French into the English-only admin.
 *
 * Tenancy is the same predicate everywhere: a conversation belongs to one
 * person AND one scope, and a church conversation to one church. A foreign
 * conversation id silently starts a new conversation rather than saying
 * whether it exists.
 */

export type AssistantScope = "church" | "platform";

type Who = { scope: AssistantScope; churchId: string | null; userId: string };

/** The fixed copy stored for answers the model did not write. */
export type FixedCopy = {
  notInGuides: string;
  declined: string;
  cutOff: string;
  failed: string;
};

export type AskResult =
  | {
      ok: true;
      conversationId: string;
      question: { id: string; content: string; redactions: number };
      answer: Extract<AssistantThreadItem, { role: "assistant" }>;
    }
  | {
      ok: false;
      code: AssistantErrorCode;
      vars?: Record<string, number>;
      /** runAi's reason, when the code is "dormant". */
      reason?: string;
      /** runAi's English message, when the code is "dormant". Logs and superadmin only. */
      message?: string;
    };

/*
 * The request has to fit FEATURE_POLICY.chat.maxRequestBytes (32 KB) as JSON.
 * The extracts take 12K characters; history is clipped per message and the
 * oldest exchange is dropped until the texts fit under this, measured as
 * UTF-8 JSON (the guides are full of dashes and arrows, three bytes each, and
 * every newline is two). The rest is headroom for the envelope and for
 * runAi's placeholders, which can be longer than what they replace.
 */
const REQUEST_BYTE_BUDGET = 28_000;
const HISTORY_CLIP = 1_500;
/** What scrubFreeText may keep of the main turn. Above the budget, so it never truncates a prompt we built. */
const TURN_MAX_CHARS = 30_000;

function convPredicate(w: Who, conversationId: string) {
  return w.scope === "church" && w.churchId
    ? and(
        eq(assistantConversation.id, conversationId),
        eq(assistantConversation.userId, w.userId),
        eq(assistantConversation.scope, "church"),
        eq(assistantConversation.churchId, w.churchId),
      )
    : and(
        eq(assistantConversation.id, conversationId),
        eq(assistantConversation.userId, w.userId),
        eq(assistantConversation.scope, "platform"),
        isNull(assistantConversation.churchId),
      );
}

function scopeOf(w: Who): { scope: AssistantScope; churchId: string | null } {
  // A church scope with no church is impossible by CHECK; normalise first.
  return w.scope === "church" && w.churchId
    ? { scope: "church", churchId: w.churchId }
    : { scope: "platform", churchId: null };
}

export function resolveSources(sources: string[]): AssistantSource[] {
  return sources.map((ref) => {
    if (ref.startsWith("guide:")) {
      const slug = ref.slice(6);
      return { ref, title: guideTitle(slug) ?? slug, href: `/help/${slug}` };
    }
    return { ref, title: "Approved answer", href: null };
  });
}

async function approvedAnswers(): Promise<ApprovedAnswer[]> {
  /*
   * Read fresh, no unstable_cache: an answer approved a minute ago should be
   * used on the next question, and a cached Date would come back as a string.
   */
  const rows = await db
    .select({
      id: assistantAnswer.id,
      question: assistantAnswer.question,
      answer: assistantAnswer.answer,
      keywords: assistantAnswer.keywords,
    })
    .from(assistantAnswer)
    .where(eq(assistantAnswer.status, "approved"))
    .orderBy(asc(assistantAnswer.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r, keywords: r.keywords ?? [] }));
}

/**
 * The names to remove: words in the question that are on THIS church's
 * register, plus the asker's own name and the church name's words. The
 * register is compared here and never sent; only the typed words that match
 * are replaced.
 */
async function namesToRedact(input: {
  churchId: string | null;
  text: string;
  userName: string;
  churchName: string | null;
}): Promise<Set<string>> {
  const out = new Set<string>();
  for (const w of input.userName.toLowerCase().split(/[^a-z]+/)) if (isNameWord(w)) out.add(w);
  for (const w of (input.churchName ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (isNameWord(w)) out.add(w);
  }
  const cand = nameCandidates(input.text);
  if (!input.churchId || cand.length === 0) return out;

  const first = sql<string>`lower(${member.firstName})`;
  const middle = sql<string | null>`lower(${member.middleName})`;
  const last = sql<string | null>`lower(${member.lastName})`;
  const rows = await db
    .selectDistinct({ f: first, m: middle, l: last })
    .from(member)
    .where(
      and(
        eq(member.churchId, input.churchId),
        or(inArray(first, cand), inArray(middle, cand), inArray(last, cand)),
      ),
    )
    .limit(200);
  const typed = new Set(cand);
  for (const r of rows) {
    for (const part of [r.f, r.m, r.l]) {
      for (const w of (part ?? "").split(/\s+/)) if (typed.has(w)) out.add(w);
    }
  }
  return out;
}

/** The sentinel that rolls back a write when the conversation filled up mid-flight. */
class ConversationFull extends Error {}

export async function askAssistant(input: {
  scope: AssistantScope;
  churchId: string | null;
  userId: string;
  userName: string;
  churchName: string | null;
  locale: string;
  conversationId: string | null;
  text: string;
  copy: FixedCopy;
}): Promise<AskResult> {
  const who: Who = { scope: input.scope, churchId: input.churchId, userId: input.userId };
  const { scope, churchId } = scopeOf(who);
  const text = input.text.trim();
  if (!text) return { ok: false, code: "invalid" };
  if (text.length > MAX_QUESTION_CHARS) {
    return { ok: false, code: "tooLong", vars: { max: MAX_QUESTION_CHARS } };
  }

  const rl = rateLimit(`assistant:${input.userId}`, BURST_LIMIT.count, BURST_LIMIT.windowMs);
  if (!rl.ok) {
    return {
      ok: false,
      code: "rateLimited",
      vars: { minutes: Math.max(1, Math.ceil(rl.retryAfterSec / 60)) },
    };
  }

  // The real bound: one flat count on one table, by the person.
  const [{ n: today }] = await db
    .select({ n: count() })
    .from(assistantMessage)
    .where(
      and(
        eq(assistantMessage.userId, input.userId),
        eq(assistantMessage.role, "user"),
        gt(assistantMessage.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  if (Number(today) >= DAILY_QUESTIONS) {
    return { ok: false, code: "dailyLimit", vars: { max: DAILY_QUESTIONS } };
  }

  let conversationId: string | null = null;
  let priorRows: { role: string; content: string; answerKind: string | null }[] = [];
  if (input.conversationId) {
    const [conv] = await db
      .select({ id: assistantConversation.id, messageCount: assistantConversation.messageCount })
      .from(assistantConversation)
      .where(convPredicate({ scope, churchId, userId: input.userId }, input.conversationId))
      .limit(1);
    if (conv) {
      if (conv.messageCount + 2 > MAX_CONVERSATION_MESSAGES) {
        return { ok: false, code: "conversationFull" };
      }
      conversationId = conv.id;
      priorRows = await db
        .select({
          role: assistantMessage.role,
          content: assistantMessage.content,
          answerKind: assistantMessage.answerKind,
        })
        .from(assistantMessage)
        .where(
          and(
            eq(assistantMessage.conversationId, conv.id),
            churchId
              ? eq(assistantMessage.churchId, churchId)
              : isNull(assistantMessage.churchId),
          ),
        )
        // Both rows of an exchange carry the transaction's now(); "user" sorts
        // after "assistant", so the role order is reversed to keep the
        // question first.
        .orderBy(asc(assistantMessage.createdAt), desc(assistantMessage.role))
        .limit(MAX_CONVERSATION_MESSAGES);
    }
  }

  const names = await namesToRedact({
    churchId,
    text,
    userName: input.userName,
    churchName: input.churchName,
  });
  const scrubbed = scrub(text, names);
  if (isOnlyPlaceholders(scrubbed.text)) return { ok: false, code: "onlyPersonalDetails" };

  const approved = await approvedAnswers();
  const found = retrieve(scrubbed.text, approved);
  const turn = buildAssistantUserTurn({
    locale: input.locale,
    guideMap: guideMap(),
    extracts: found.extracts,
    question: scrubbed.text,
  });

  let history = historyForModel(priorRows).map((h) => ({
    role: h.role,
    content: h.content.length > HISTORY_CLIP ? `${h.content.slice(0, HISTORY_CLIP)}…` : h.content,
  }));
  const size = () =>
    Buffer.byteLength(
      JSON.stringify([ASSISTANT_SYSTEM_PROMPT, turn, ...history.map((h) => h.content)]),
      "utf8",
    );
  while (history.length >= 2 && size() > REQUEST_BYTE_BUDGET) history = history.slice(2);

  const result = await runAi({
    churchId,
    feature: "chat",
    model: MODELS.haiku,
    promptId: ASSISTANT_PROMPT_ID,
    messages: [
      ...history.map((h) => ({ role: h.role, content: scrubFreeText(h.content, TURN_MAX_CHARS) })),
      { role: "user" as const, content: scrubFreeText(turn, TURN_MAX_CHARS) },
    ],
    maxTokens: CHAT_MAX_TOKENS,
    actorUserId: input.userId,
  });

  if (!result.ok && !isModelFailure(result.reason)) {
    // Nothing was sent, so nothing is stored. Logged, because a reason we did
    // not expect (invalid_input above all) is a bug to find, not a state.
    console.error("[assistant] not sent", { scope, churchId, reason: result.reason });
    /*
     * A request runAi refused on its own terms is not "the assistant is off":
     * saying so would hide the input for the session over one oversized
     * history. It gets its own code, and a new conversation usually fixes it.
     */
    const code = result.reason === "invalid_input" || result.reason === "payload_rejected" ? "notSent" : "dormant";
    return { ok: false, code, reason: result.reason, message: result.message };
  }

  const known = { guides: guideSlugs(), answers: found.answerCodes };
  const parsed = result.ok ? parseAnswer(result.text, known) : null;
  const grounded = parsed ? parsed.grounded : null;
  const kind: AnswerKind = answerKindFor(
    result.ok ? { ok: true } : { ok: false, reason: result.reason },
    grounded,
  );
  // An answered reply whose body was empty is a failed one, whatever it cited.
  const finalKind: AnswerKind = kind === "answered" && !parsed?.body ? "failed" : kind;
  const fixed: Record<Exclude<AnswerKind, "answered">, string> = {
    not_in_guides: input.copy.notInGuides,
    refused: input.copy.declined,
    truncated: input.copy.cutOff,
    failed: input.copy.failed,
  };
  const body = finalKind === "answered" ? (parsed?.body ?? "") : fixed[finalKind];
  const sources = finalKind === "answered" ? (parsed?.sources ?? []) : [];
  const review = reviewStatusFor({ answerKind: finalKind, grounded, helpful: null });
  const tokens = result.ok
    ? { input: result.usage.inputTokens, output: result.usage.outputTokens }
    : { input: null, output: null };

  try {
    const written = await db.transaction(async (tx) => {
      let convId = conversationId;
      if (!convId) {
        const [conv] = await tx
          .insert(assistantConversation)
          .values({ scope, churchId, userId: input.userId, locale: input.locale })
          .returning({ id: assistantConversation.id });
        convId = conv.id;
      }
      const [q] = await tx
        .insert(assistantMessage)
        .values({
          conversationId: convId,
          churchId,
          userId: input.userId,
          role: "user",
          content: scrubbed.text,
          redactions: scrubbed.redactions,
        })
        .returning({ id: assistantMessage.id });
      const [a] = await tx
        .insert(assistantMessage)
        .values({
          conversationId: convId,
          churchId,
          userId: input.userId,
          role: "assistant",
          content: body,
          answerKind: finalKind,
          sources,
          reviewStatus: review,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
        })
        .returning({ id: assistantMessage.id });
      // The ceiling is repeated in the UPDATE so two tabs cannot both take the
      // last slot; a miss rolls the whole exchange back.
      const bumped = await tx
        .update(assistantConversation)
        .set({
          messageCount: sql`${assistantConversation.messageCount} + 2`,
          lastMessageAt: new Date(),
        })
        .where(
          and(
            eq(assistantConversation.id, convId),
            lte(assistantConversation.messageCount, MAX_CONVERSATION_MESSAGES - 2),
          ),
        )
        .returning({ id: assistantConversation.id });
      if (bumped.length !== 1) throw new ConversationFull();
      return { convId, questionId: q.id, answerId: a.id };
    });

    return {
      ok: true,
      conversationId: written.convId,
      question: { id: written.questionId, content: scrubbed.text, redactions: scrubbed.redactions },
      answer: {
        role: "assistant",
        id: written.answerId,
        content: body,
        kind: finalKind,
        sources: resolveSources(sources),
        helpful: null,
      },
    };
  } catch (e) {
    if (e instanceof ConversationFull) return { ok: false, code: "conversationFull" };
    throw e;
  }
}

/**
 * The conversation to show when the panel opens: the one asked for, or this
 * person's latest from the last 7 days. Same tenancy predicate as askAssistant.
 */
export async function loadThread(input: {
  scope: AssistantScope;
  churchId: string | null;
  userId: string;
  conversationId?: string | null;
}): Promise<{ conversationId: string | null; messageCount: number; items: AssistantThreadItem[] }> {
  const { scope, churchId } = scopeOf({ ...input, scope: input.scope });
  const who = { scope, churchId, userId: input.userId };

  let conv: { id: string; messageCount: number } | undefined;
  if (input.conversationId) {
    [conv] = await db
      .select({ id: assistantConversation.id, messageCount: assistantConversation.messageCount })
      .from(assistantConversation)
      .where(convPredicate(who, input.conversationId))
      .limit(1);
  } else {
    [conv] = await db
      .select({ id: assistantConversation.id, messageCount: assistantConversation.messageCount })
      .from(assistantConversation)
      .where(
        and(
          eq(assistantConversation.userId, input.userId),
          eq(assistantConversation.scope, scope),
          churchId
            ? eq(assistantConversation.churchId, churchId)
            : isNull(assistantConversation.churchId),
          gt(assistantConversation.lastMessageAt, sql`now() - interval '7 days'`),
        ),
      )
      .orderBy(desc(assistantConversation.lastMessageAt))
      .limit(1);
  }
  if (!conv) return { conversationId: null, messageCount: 0, items: [] };

  const rows = await db
    .select({
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      redactions: assistantMessage.redactions,
      answerKind: assistantMessage.answerKind,
      sources: assistantMessage.sources,
      helpful: assistantMessage.helpful,
    })
    .from(assistantMessage)
    .where(
      and(
        eq(assistantMessage.conversationId, conv.id),
        churchId ? eq(assistantMessage.churchId, churchId) : isNull(assistantMessage.churchId),
      ),
    )
    // Same ordering rule as askAssistant: question before answer.
    .orderBy(asc(assistantMessage.createdAt), desc(assistantMessage.role))
    .limit(MAX_CONVERSATION_MESSAGES);

  const items: AssistantThreadItem[] = rows.map((r) =>
    r.role === "user"
      ? { role: "user", id: r.id, content: r.content, redactions: r.redactions }
      : {
          role: "assistant",
          id: r.id,
          content: r.content,
          kind: (r.answerKind ?? "failed") as AnswerKind,
          sources: resolveSources(r.sources ?? []),
          helpful: r.helpful,
        },
  );
  return { conversationId: conv.id, messageCount: conv.messageCount, items };
}

/**
 * "Did this help?" The message must be an assistant row in a conversation
 * this person owns, in this scope; the UPDATE repeats the church predicate.
 */
export async function rateAnswer(input: {
  scope: AssistantScope;
  churchId: string | null;
  userId: string;
  messageId: string;
  helpful: boolean;
}): Promise<{ ok: boolean }> {
  const { churchId } = scopeOf({ ...input, scope: input.scope });
  const churchMatch = churchId
    ? eq(assistantMessage.churchId, churchId)
    : isNull(assistantMessage.churchId);

  const [row] = await db
    .select({
      id: assistantMessage.id,
      answerKind: assistantMessage.answerKind,
      sources: assistantMessage.sources,
      reviewStatus: assistantMessage.reviewStatus,
    })
    .from(assistantMessage)
    .innerJoin(
      assistantConversation,
      eq(assistantConversation.id, assistantMessage.conversationId),
    )
    .where(
      and(
        eq(assistantMessage.id, input.messageId),
        eq(assistantMessage.role, "assistant"),
        eq(assistantConversation.userId, input.userId),
        churchMatch,
      ),
    )
    .limit(1);
  if (!row) return { ok: false };

  const kind = (row.answerKind ?? "failed") as AnswerKind;
  const updated = await db
    .update(assistantMessage)
    .set({
      helpful: input.helpful,
      feedbackAt: new Date(),
      reviewStatus: reviewStatusFor({
        answerKind: kind,
        grounded: groundedFromStored(kind, row.sources ?? []),
        helpful: input.helpful,
        current: row.reviewStatus,
      }),
    })
    .where(and(eq(assistantMessage.id, row.id), churchMatch))
    .returning({ id: assistantMessage.id });
  return { ok: updated.length === 1 };
}
