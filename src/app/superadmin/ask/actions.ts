"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { en } from "@/lib/i18n/dictionaries/en";
import { englishT } from "@/lib/i18n/translate";
import { MAX_QUESTION_CHARS } from "@/lib/assistant/shared";
import { OUT_OF_SCOPE_COPY_EN, type AdvisorUnavailableReason, type ChatUsage } from "@/lib/assistant/advisor-shared";
import { platformShellAsker, type AssistantAsker } from "@/lib/assistant/asker";
import { askAssistant, getChatUsage, rateAnswer, type AskResult } from "@/lib/assistant/server";
import {
  deleteConversation,
  listConversations,
  listSavedAnswers,
  loadConversation,
  renameConversation,
  setAnswerSaved,
} from "@/lib/assistant/chat";
import {
  limitReached,
  type AskChatResult,
  type ChatListResult,
  type ChatState,
  type ChatStateResult,
  type LoadChatResult,
  type OpenChatResult,
  type PlainResult,
  type RenameChatResult,
  type SaveAnswerResult,
  type SavedListResult,
} from "@/components/assistant/chat-shared";

/*
 * The chat page's actions, from the superadmin shell (/superadmin/ask). The
 * same shapes as the church page's, so one client component serves both.
 *
 * Any admin may ask, under the platform scope, the platform budget and their
 * own day (ASSISTANT_ADMIN_DAILY). Whether an answer may use the platform's
 * figures is the core's rule: it needs platform.overview.view, the same
 * permission the platform briefing needs, and without it answers come from
 * the guides.
 *
 * English only: codes are turned into sentences with englishT(en), never
 * getT(), which would follow a French admin's locale cookie into an
 * English-only shell. When AI cannot run, the sentence is runAi's own, which
 * names the cause (no key, the kill switch, a pause, the budget) the way an
 * operator needs it named.
 */

const t = englishT(en);

/** Why the advisor is not answering, in an operator's words. Only role and paused can happen here. */
const ADVISOR_NOTE: Record<AdvisorUnavailableReason, string> = {
  role: "Answers about the platform's figures need the dashboard permission (platform.overview.view). Until then, answers come from the guides.",
  paused:
    "Advisor answers are off: paused on /superadmin/ai, or AI itself is off. Until then, answers come from the guides.",
  plan: "Advisor answers are not available here. Answers come from the guides.",
  rollout: "Advisor answers are not available here. Answers come from the guides.",
  consent: "Advisor answers are not available here. Answers come from the guides.",
};

const uuid = z.string().uuid();
const cursor = z.string().max(200).nullable().optional();

/** Any admin may ask; anybody else goes back to their own dashboard. */
async function requireAsker(): Promise<AssistantAsker> {
  const asker = await platformShellAsker();
  if (!asker) redirect("/dashboard");
  return asker;
}

function stateFrom(usage: ChatUsage): ChatState {
  return {
    usage,
    dormant: usage.dormant ? usage.dormant.message : null,
    advisorNote: advisorNoteFor(usage),
  };
}

/*
 * Every note ends "answers come from the guides", which is only true while
 * something can be asked. When AI cannot run at all, runAi's own sentence
 * (the dormant line) names why, and when the day's allowance is used the
 * composer says so; a note on top would contradict either.
 */
function advisorNoteFor(usage: ChatUsage): string | null {
  const reason = usage.mode === "help" ? usage.advisorUnavailableReason : null;
  if (!reason || usage.dormant || limitReached(usage)) return null;
  return ADVISOR_NOTE[reason];
}

async function stateFor(asker: AssistantAsker): Promise<ChatState> {
  return stateFrom(await getChatUsage(asker));
}

function errorText(r: Extract<AskResult, { ok: false }>): string {
  switch (r.code) {
    case "dormant":
    case "notSent":
      return r.message ?? `AI is not available (${r.reason ?? "unknown reason"}). Nothing was sent.`;
    case "tooLong":
      return t("assistant.tooLong", r.vars);
    case "rateLimited":
      return t("assistant.rateLimited", r.vars);
    case "dailyLimit":
      return t("assistantPage.dailyLimit", r.vars);
    case "monthlyLimit":
      // The platform scope has no monthly allowance; kept so a new rule can never print a raw code.
      return t("assistantPage.monthlyLimit", r.vars);
    case "conversationFull":
      return t("assistant.conversationFull");
    case "onlyPersonalDetails":
      return t("assistant.onlyPersonalDetails");
    case "notInDemo":
      return t("assistant.notInDemo");
    case "invalid":
      return t("assistant.tooLong", { max: MAX_QUESTION_CHARS });
  }
}

export async function loadChatState(input: {
  conversationId?: string | null;
  tab?: string | null;
}): Promise<LoadChatResult> {
  const asker = await requireAsker();
  const id = uuid.safeParse(input.conversationId);
  const [state, chats, opened, saved] = await Promise.all([
    stateFor(asker),
    listConversations({ asker }),
    id.success ? loadConversation({ asker, conversationId: id.data }) : Promise.resolve(null),
    input.tab === "saved" ? listSavedAnswers({ asker }) : Promise.resolve(null),
  ]);
  return { ok: true, state, chats, opened, missing: !!input.conversationId && !opened, saved };
}

export async function refreshChatState(): Promise<ChatStateResult> {
  const asker = await requireAsker();
  return { ok: true, state: await stateFor(asker) };
}

const askSchema = z.object({
  conversationId: uuid.nullable(),
  text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});

export async function askQuestion(input: { conversationId: string | null; text: string }): Promise<AskChatResult> {
  const asker = await requireAsker();
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "tooLong", error: t("assistant.tooLong", { max: MAX_QUESTION_CHARS }), state: null };
  }
  const res = await askAssistant({
    asker,
    locale: "en",
    conversationId: parsed.data.conversationId,
    text: parsed.data.text,
    copy: {
      notInGuides: t("assistant.notInGuides"),
      declined: t("assistant.declined"),
      cutOff: t("assistant.cutOff"),
      // Stored and shown again whenever the chat is reopened, so it cannot promise the question is still in the box.
      failed: t("assistantPage.failedStored"),
      outOfScope: OUT_OF_SCOPE_COPY_EN,
    },
  });
  if (res.ok) {
    const { usage, ...answered } = res;
    return { ...answered, state: stateFrom(usage) };
  }
  const changed = res.code === "monthlyLimit" || res.code === "dailyLimit" || res.code === "dormant";
  return { ok: false, code: res.code, error: errorText(res), state: changed ? await stateFor(asker) : null };
}

export async function listChats(input: { cursor?: string | null }): Promise<ChatListResult> {
  const asker = await requireAsker();
  const c = cursor.safeParse(input.cursor);
  const page = await listConversations({ asker, cursor: c.success ? (c.data ?? null) : null });
  return { ok: true, ...page };
}

export async function openChat(input: { conversationId: string }): Promise<OpenChatResult> {
  const asker = await requireAsker();
  const id = uuid.safeParse(input.conversationId);
  const opened = id.success ? await loadConversation({ asker, conversationId: id.data }) : null;
  if (!opened) return { ok: false, error: t("assistantPage.chatNotFound"), missing: true };
  return { ok: true, ...opened };
}

const renameSchema = z.object({ conversationId: uuid, title: z.string().trim().min(1).max(200) });

export async function renameChat(input: { conversationId: string; title: string }): Promise<RenameChatResult> {
  const asker = await requireAsker();
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistantPage.renameFailed") };
  const res = await renameConversation({ asker, ...parsed.data });
  return res.ok ? { ok: true, title: res.title } : { ok: false, error: t("assistantPage.renameFailed") };
}

export async function deleteChat(input: { conversationId: string }): Promise<PlainResult> {
  const asker = await requireAsker();
  const id = uuid.safeParse(input.conversationId);
  if (!id.success) return { ok: false, error: t("assistantPage.deleteFailed") };
  const res = await deleteConversation({ asker, conversationId: id.data });
  return res.ok ? { ok: true } : { ok: false, error: t("assistantPage.deleteFailed") };
}

const saveSchema = z.object({ messageId: uuid, saved: z.boolean() });

export async function saveAnswer(input: { messageId: string; saved: boolean }): Promise<SaveAnswerResult> {
  const asker = await requireAsker();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistantPage.saveFailed") };
  const res = await setAnswerSaved({ asker, ...parsed.data });
  return res.ok ? { ok: true, savedAt: res.savedAt } : { ok: false, error: t("assistantPage.saveFailed") };
}

export async function listSaved(input: { cursor?: string | null }): Promise<SavedListResult> {
  const asker = await requireAsker();
  const c = cursor.safeParse(input.cursor);
  const page = await listSavedAnswers({ asker, cursor: c.success ? (c.data ?? null) : null });
  return { ok: true, ...page };
}

const rateSchema = z.object({ messageId: uuid, helpful: z.boolean() });

export async function rateChatAnswer(input: { messageId: string; helpful: boolean }): Promise<PlainResult> {
  const asker = await requireAsker();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistant.feedbackFailed") };
  const res = await rateAnswer({ asker, ...parsed.data });
  return res.ok ? { ok: true } : { ok: false, error: t("assistant.feedbackFailed") };
}
