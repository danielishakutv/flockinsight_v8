"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { assistantAnswer, assistantMessage } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { en } from "@/lib/i18n/dictionaries/en";
import { englishT } from "@/lib/i18n/translate";
import { GUIDES } from "@/lib/help-guides";
import { aiReadiness, runAi } from "@/lib/ai/run-ai";
import { scrubFreeText } from "@/lib/ai/safe-text";
import { MODELS } from "@/lib/ai/config";
import {
  CANNED_DRAFT_MAX_TOKENS,
  CANNED_DRAFT_PROMPT_ID,
  MAX_QUESTION_CHARS,
  buildCannedDraftPrompt,
  parseCannedDraft,
  type AssistantSendResult,
  type AssistantThreadResult,
} from "@/lib/assistant/shared";
import { scrubPatterns } from "@/lib/assistant/scrub";
import { retrieve } from "@/lib/assistant/grounding";
import { askAssistant, loadThread, rateAnswer } from "@/lib/assistant/server";
import { platformShellAsker } from "@/lib/assistant/asker";
import { OUT_OF_SCOPE_COPY_EN } from "@/lib/assistant/advisor-shared";

/*
 * The help assistant from the superadmin shell, and the reviewed pipeline that
 * grows its canned answers. English only: codes are translated with
 * englishT(en), never getT(), which would follow a French admin's locale
 * cookie into an English-only shell.
 *
 * Asking needs only platform access (any admin may ask, under the platform
 * scope and budget). Everything that changes what EVERY church's assistant is
 * grounded on needs platform.assistant.review.
 */

const t = englishT(en);

/*
 * RETIRED (0.83.0): sendPlatformAssistantMessage, getPlatformAssistantThread
 * and ratePlatformAssistantAnswer served the side panel, and only the retired
 * assistant-panel.tsx imports them. /superadmin/ask has its own actions
 * (app/superadmin/ask/actions.ts). The reviewed pipeline below is live.
 */

/** Any admin may ask, under the platform scope, budget and their own day. */
async function requireAsker() {
  const asker = await platformShellAsker();
  if (!asker) redirect("/dashboard");
  return asker;
}

export async function sendPlatformAssistantMessage(input: {
  conversationId?: string | null;
  text: string;
}): Promise<AssistantSendResult> {
  const asker = await requireAsker();
  const parsed = z
    .object({
      conversationId: z.string().uuid().nullable().optional(),
      text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "tooLong", error: t("assistant.tooLong", { max: MAX_QUESTION_CHARS }) };
  }
  const res = await askAssistant({
    asker,
    locale: "en",
    conversationId: parsed.data.conversationId ?? null,
    text: parsed.data.text,
    copy: {
      notInGuides: t("assistant.notInGuides"),
      declined: t("assistant.declined"),
      cutOff: t("assistant.cutOff"),
      failed: t("assistant.failed"),
      outOfScope: OUT_OF_SCOPE_COPY_EN,
    },
  });
  if (res.ok) return res;
  const error =
    res.code === "dormant" || res.code === "notSent"
      ? (res.message ?? `AI is not available (${res.reason ?? "unknown reason"}). Nothing was sent.`)
      : res.code === "tooLong" || res.code === "rateLimited" || res.code === "dailyLimit"
        ? t(`assistant.${res.code}`, res.vars)
        : res.code === "monthlyLimit"
          ? // The platform scope has no monthly allowance; kept so a new code can never print a raw key.
            "This month's question allowance has been used. It starts again on the 1st (UTC)."
          : res.code === "invalid"
            ? t("assistant.tooLong", { max: MAX_QUESTION_CHARS })
            : t(`assistant.${res.code}`);
  return { ok: false, code: res.code, error };
}

export async function getPlatformAssistantThread(input: {
  conversationId?: string | null;
}): Promise<AssistantThreadResult> {
  const asker = await requireAsker();
  const id = z.string().uuid().nullable().optional().safeParse(input.conversationId);
  const [thread, ready] = await Promise.all([
    loadThread({ asker, conversationId: id.success ? (id.data ?? null) : null }),
    aiReadiness({ churchId: null, feature: "chat" }),
  ]);
  return { ok: true, ...thread, dormant: "ready" in ready ? null : ready.message };
}

export async function ratePlatformAssistantAnswer(input: {
  messageId: string;
  helpful: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const asker = await requireAsker();
  const parsed = z.object({ messageId: z.string().uuid(), helpful: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistant.feedbackFailed") };
  const res = await rateAnswer({ asker, ...parsed.data });
  return res.ok ? { ok: true } : { ok: false, error: t("assistant.feedbackFailed") };
}

/* ============================================================
 * The reviewed pipeline
 * ========================================================== */

export type ReviewResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string; note?: string } | { ok: false; error: string };

const GUIDE_SLUGS = new Set(GUIDES.map((g) => g.slug));

function revalidateAssistant(id?: string) {
  revalidatePath("/superadmin/assistant");
  if (id) revalidatePath(`/superadmin/assistant/answers/${id}`);
}

/**
 * A first draft of a canned answer for an open queue item. The model only
 * drafts; a human edits and approves. When AI is dormant or fails, the draft
 * is still created with the question filled in, and the note says why.
 */
export async function draftCannedAnswer(input: { messageId: string }): Promise<CreateResult> {
  const admin = await requirePlatform("platform.assistant.review");
  const id = z.string().uuid().safeParse(input.messageId);
  if (!id.success) return { ok: false, error: "That queue item no longer exists. Refresh the page." };

  const [answer] = await db
    .select({
      id: assistantMessage.id,
      conversationId: assistantMessage.conversationId,
      content: assistantMessage.content,
      mode: assistantMessage.mode,
      createdAt: assistantMessage.createdAt,
    })
    .from(assistantMessage)
    .where(
      and(
        eq(assistantMessage.id, id.data),
        eq(assistantMessage.role, "assistant"),
        eq(assistantMessage.reviewStatus, "open"),
      ),
    )
    .limit(1);
  if (!answer) {
    return { ok: false, error: "That item is no longer open — someone may have resolved it. Refresh the page." };
  }
  /*
   * An advisor answer quotes one church's figures. Sending it to the drafting
   * prompt would put that church's numbers into a draft meant for EVERY
   * church, one careless approval away from being shown to all of them.
   */
  if (answer.mode === "advisor") {
    return {
      ok: false,
      error: "This answer quotes a church's own figures, so it is not drafted with AI. Write the canned answer by hand.",
    };
  }

  // The question is the latest user row at or before the answer.
  const users = await db
    .select({ content: assistantMessage.content, createdAt: assistantMessage.createdAt })
    .from(assistantMessage)
    .where(
      and(
        eq(assistantMessage.conversationId, answer.conversationId),
        eq(assistantMessage.role, "user"),
        lte(assistantMessage.createdAt, answer.createdAt),
      ),
    )
    .orderBy(asc(assistantMessage.createdAt));
  const question = users.at(-1)?.content ?? "";

  let draftQuestion = question.slice(0, 300);
  let draftAnswer = "";
  let note: string | undefined;

  const found = retrieve(question, []);
  const result = await runAi({
    churchId: null,
    feature: "chat",
    model: MODELS.haiku,
    promptId: CANNED_DRAFT_PROMPT_ID,
    messages: [
      {
        role: "user",
        content: scrubFreeText(
          buildCannedDraftPrompt({
            question,
            answerGiven: answer.content,
            extracts: found.extracts,
          }),
          30_000,
        ),
      },
    ],
    maxTokens: CANNED_DRAFT_MAX_TOKENS,
    actorUserId: admin.id,
  });
  if (result.ok) {
    const parsed = parseCannedDraft(result.text);
    if (parsed) {
      draftQuestion = parsed.question.slice(0, 300);
      draftAnswer = parsed.answer.slice(0, 2000);
    } else {
      note = "The AI draft did not follow the QUESTION/ANSWER format, so only the question was filled in. Write the answer yourself.";
    }
  } else {
    note = `No AI draft: ${result.message} The question is filled in; write the answer yourself.`;
  }

  const [row] = await db
    .insert(assistantAnswer)
    .values({
      question: draftQuestion,
      answer: draftAnswer,
      keywords: [],
      status: "draft",
      draftedByAi: result.ok && draftAnswer.length > 0,
      sourceMessageId: answer.id,
      createdBy: admin.id,
    })
    .returning({ id: assistantAnswer.id });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.assistant.answer.create",
    summary: `Drafted a canned answer from the assistant queue${result.ok ? " with AI" : ""}`,
    targetType: "assistant_answer",
    targetId: row.id,
  });
  revalidateAssistant();
  return { ok: true, id: row.id, note };
}

/** A blank draft, for writing an answer by hand. */
export async function createCannedAnswer(input?: { messageId?: string }): Promise<CreateResult> {
  const admin = await requirePlatform("platform.assistant.review");
  let sourceMessageId: string | null = null;
  let question = "";
  const id = z.string().uuid().safeParse(input?.messageId);
  if (id.success) {
    const [msg] = await db
      .select({ id: assistantMessage.id, conversationId: assistantMessage.conversationId, createdAt: assistantMessage.createdAt })
      .from(assistantMessage)
      .where(and(eq(assistantMessage.id, id.data), eq(assistantMessage.role, "assistant")))
      .limit(1);
    if (msg) {
      sourceMessageId = msg.id;
      const users = await db
        .select({ content: assistantMessage.content })
        .from(assistantMessage)
        .where(
          and(
            eq(assistantMessage.conversationId, msg.conversationId),
            eq(assistantMessage.role, "user"),
            lte(assistantMessage.createdAt, msg.createdAt),
          ),
        )
        .orderBy(asc(assistantMessage.createdAt));
      question = (users.at(-1)?.content ?? "").slice(0, 300);
    }
  }
  const [row] = await db
    .insert(assistantAnswer)
    .values({ question, answer: "", keywords: [], status: "draft", sourceMessageId, createdBy: admin.id })
    .returning({ id: assistantAnswer.id });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.assistant.answer.create",
    summary: "Started a canned answer by hand",
    targetType: "assistant_answer",
    targetId: row.id,
  });
  revalidateAssistant();
  return { ok: true, id: row.id };
}

const saveSchema = z.object({
  id: z.string().uuid(),
  question: z.string().trim().min(5, "Write the question (at least 5 characters).").max(300),
  answer: z.string().trim().min(20, "Write the answer (at least 20 characters).").max(2000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(12, "Keep it to 12 keywords."),
  guideSlug: z.string().nullable(),
});

/**
 * Saves a draft. Only drafts are editable: to change an approved answer,
 * retire it and draft again, so the text that reached prompts is preserved.
 */
export async function saveCannedAnswer(input: z.input<typeof saveSchema>): Promise<ReviewResult> {
  await requirePlatform("platform.assistant.review");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  if (d.guideSlug !== null && !GUIDE_SLUGS.has(d.guideSlug)) {
    return { ok: false, error: "That guide no longer exists. Pick another or leave it empty." };
  }
  const leaks =
    scrubPatterns(d.question).redactions +
    scrubPatterns(d.answer).redactions +
    scrubPatterns(d.keywords.join(" ")).redactions;
  if (leaks > 0) {
    return {
      ok: false,
      error:
        "This answer contains what looks like an email, phone number or address. Canned answers are shown to every church — remove it and save again.",
    };
  }
  const updated = await db
    .update(assistantAnswer)
    .set({
      question: d.question,
      answer: d.answer,
      keywords: [...new Set(d.keywords.map((k) => k.toLowerCase()))],
      guideSlug: d.guideSlug,
    })
    .where(and(eq(assistantAnswer.id, d.id), eq(assistantAnswer.status, "draft")))
    .returning({ id: assistantAnswer.id });
  if (updated.length !== 1) {
    return { ok: false, error: "Only drafts can be edited. Retire this answer and draft a new one to change it." };
  }
  revalidateAssistant(d.id);
  return { ok: true };
}

/**
 * Approves a draft: from now on its text reaches every church's prompts. The
 * status predicate is repeated in the UPDATE, so two reviewers cannot both
 * approve, and the returning() count says whether this one did.
 */
export async function approveCannedAnswer(input: { id: string }): Promise<ReviewResult> {
  const admin = await requirePlatform("platform.assistant.review");
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "That answer no longer exists." };

  const [current] = await db
    .select({ question: assistantAnswer.question, answer: assistantAnswer.answer })
    .from(assistantAnswer)
    .where(eq(assistantAnswer.id, id.data))
    .limit(1);
  if (!current) return { ok: false, error: "That answer no longer exists." };
  if (current.question.trim().length < 5 || current.answer.trim().length < 20) {
    return { ok: false, error: "Save a question and an answer before approving." };
  }
  if (scrubPatterns(`${current.question}\n${current.answer}`).redactions > 0) {
    return {
      ok: false,
      error:
        "This answer contains what looks like an email, phone number or address. Remove it and save before approving.",
    };
  }

  const approved = await db
    .update(assistantAnswer)
    .set({ status: "approved", approvedBy: admin.id, approvedAt: new Date() })
    .where(and(eq(assistantAnswer.id, id.data), eq(assistantAnswer.status, "draft")))
    .returning({ id: assistantAnswer.id, sourceMessageId: assistantAnswer.sourceMessageId });
  if (approved.length !== 1) {
    return { ok: false, error: "Only a draft can be approved — this one was approved or retired already." };
  }
  const source = approved[0].sourceMessageId;
  if (source) {
    await db
      .update(assistantMessage)
      .set({ reviewStatus: "resolved", resolvedAnswerId: id.data })
      .where(and(eq(assistantMessage.id, source), eq(assistantMessage.reviewStatus, "open")));
  }
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.assistant.answer.approve",
    summary: `Approved a canned answer for every church's assistant: "${current.question.slice(0, 80)}"`,
    targetType: "assistant_answer",
    targetId: id.data,
    severity: "notice",
  });
  revalidateAssistant(id.data);
  return { ok: true };
}

export async function retireCannedAnswer(input: { id: string }): Promise<ReviewResult> {
  const admin = await requirePlatform("platform.assistant.review");
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "That answer no longer exists." };
  const retired = await db
    .update(assistantAnswer)
    .set({ status: "retired" })
    .where(eq(assistantAnswer.id, id.data))
    .returning({ id: assistantAnswer.id, question: assistantAnswer.question });
  if (retired.length !== 1) return { ok: false, error: "That answer no longer exists." };
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.assistant.answer.retire",
    summary: `Retired a canned answer: "${retired[0].question.slice(0, 80)}"`,
    targetType: "assistant_answer",
    targetId: id.data,
  });
  revalidateAssistant(id.data);
  return { ok: true };
}

export async function dismissQueueItem(input: { messageId: string }): Promise<ReviewResult> {
  const admin = await requirePlatform("platform.assistant.review");
  const id = z.string().uuid().safeParse(input.messageId);
  if (!id.success) return { ok: false, error: "That queue item no longer exists." };
  const dismissed = await db
    .update(assistantMessage)
    .set({ reviewStatus: "dismissed" })
    .where(and(eq(assistantMessage.id, id.data), eq(assistantMessage.reviewStatus, "open")))
    .returning({ id: assistantMessage.id });
  if (dismissed.length !== 1) {
    return { ok: false, error: "That item is no longer open — someone may have dealt with it. Refresh the page." };
  }
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.assistant.queue.dismiss",
    summary: "Dismissed an assistant queue item",
    targetType: "assistant_message",
    targetId: id.data,
  });
  revalidateAssistant();
  return { ok: true };
}
