"use server";

import { z } from "zod";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { getLocale, getT } from "@/lib/i18n/server";
import type { TFunction, TKey } from "@/lib/i18n/translate";
import { MAX_QUESTION_CHARS, dormantKeyFor } from "@/lib/assistant/shared";
import type { AdvisorUnavailableReason, ChatUsage } from "@/lib/assistant/advisor-shared";
import { churchShellAsker, type AssistantAsker } from "@/lib/assistant/asker";
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
 * The chat page's actions, from the church shell. Thin on purpose: who is
 * asking, whose allowance is counted and which rows are theirs are all
 * decided by the asker (lib/assistant/asker.ts) and the core
 * (lib/assistant/server.ts, chat.ts). What is left here is the shell's job:
 * the demo refusal, the plan gate, input validation, and turning codes into
 * sentences in the reader's language.
 *
 * Any staff login may ask, exactly as /help is open to any staff login, so no
 * church permission key gates the page. Whether an answer may use the
 * church's figures is a separate rule the core applies to every question
 * (the summaries' permission gate, the plan, the rollout, the owner's
 * consent), so a narrow role still gets the guides.
 *
 * A superadmin acting as the church asks as support: the asker files that
 * under the platform scope and budget, never the church's month.
 *
 * Only asking is refused off-plan. A chat already in somebody's history can
 * always be read, renamed, saved, unsaved and deleted: a plan change must not
 * make a person's own words unreachable, or undeletable.
 */

const ADVISOR_NOTE: Record<AdvisorUnavailableReason, TKey> = {
  plan: "assistantPage.advisorOffPlan",
  rollout: "assistantPage.advisorOffRollout",
  role: "assistantPage.advisorOffRole",
  consent: "assistantPage.advisorOffConsent",
  paused: "assistantPage.advisorOffPaused",
};

const uuid = z.string().uuid();
const cursor = z.string().max(200).nullable().optional();

async function whoAsks(): Promise<{ asker: AssistantAsker; t: TFunction; demo: boolean }> {
  const asker = await churchShellAsker();
  const t = await getT();
  // The demo church is shared by strangers and resets every two hours: it never asks.
  return { asker, t, demo: asker.kind !== "platform" && !!asker.church.isDemo };
}

function dormantText(t: TFunction, reason: string | undefined): string {
  return `${t("assistantPage.turnedOff")} ${t(`assistant.${dormantKeyFor(reason)}`)}`;
}

function stateFrom(usage: ChatUsage, t: TFunction): ChatState {
  const reason = usage.mode === "help" ? usage.advisorUnavailableReason : null;
  return {
    usage,
    dormant: usage.dormant ? dormantText(t, usage.dormant.reason) : null,
    /*
     * Every note ends "Until then I answer from the guides", which is only
     * true while something can be asked. When AI cannot run at all (the
     * owner has not turned it on, the kill switch, no key) or an allowance
     * is used up, nothing is answered, guides included, and the composer's
     * own block is the one explanation: a note on top would contradict it,
     * and a plan upsell over a church that has not switched on the free
     * feature points at the wrong way out.
     */
    advisorNote: reason && !usage.dormant && !limitReached(usage) ? t(ADVISOR_NOTE[reason]) : null,
  };
}

async function stateFor(asker: AssistantAsker, t: TFunction): Promise<ChatState> {
  return stateFrom(await getChatUsage(asker), t);
}

function errorText(t: TFunction, r: Extract<AskResult, { ok: false }>): string {
  switch (r.code) {
    case "dormant":
      return dormantText(t, r.reason);
    case "tooLong":
      return t("assistant.tooLong", r.vars);
    case "rateLimited":
      return t("assistant.rateLimited", r.vars);
    case "dailyLimit":
      return t("assistantPage.dailyLimit", r.vars);
    case "monthlyLimit":
      return t("assistantPage.monthlyLimit", r.vars);
    case "conversationFull":
      return t("assistant.conversationFull");
    case "onlyPersonalDetails":
      return t("assistant.onlyPersonalDetails");
    case "notInDemo":
      return t("assistant.notInDemo");
    case "notSent":
      return t("assistantPage.notSent");
    case "invalid":
      return t("assistant.tooLong", { max: MAX_QUESTION_CHARS });
  }
}

/**
 * Everything the page draws on arrival: the header, the first page of the
 * history, the chat the URL names and, on the saved tab, the first page of
 * saved answers. The server page calls this directly; Retry calls it again.
 */
export async function loadChatState(input: {
  conversationId?: string | null;
  tab?: string | null;
}): Promise<LoadChatResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const id = uuid.safeParse(input.conversationId);
  const [state, chats, opened, saved] = await Promise.all([
    stateFor(asker, t),
    listConversations({ asker }),
    id.success ? loadConversation({ asker, conversationId: id.data }) : Promise.resolve(null),
    input.tab === "saved" ? listSavedAnswers({ asker }) : Promise.resolve(null),
  ]);
  return { ok: true, state, chats, opened, missing: !!input.conversationId && !opened, saved };
}

/** The header again, after something outside a question may have changed it. Read-only and free. */
export async function refreshChatState(): Promise<ChatStateResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  return { ok: true, state: await stateFor(asker, t) };
}

const askSchema = z.object({
  conversationId: uuid.nullable(),
  text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});

export async function askQuestion(input: { conversationId: string | null; text: string }): Promise<AskChatResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, code: "notInDemo", error: t("assistant.notInDemo"), state: null };
  const gate = await refuseWithoutFeature("assistant");
  if (gate) return { ok: false, code: "plan", error: gate.error, state: null };

  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "tooLong", error: t("assistant.tooLong", { max: MAX_QUESTION_CHARS }), state: null };
  }

  const res = await askAssistant({
    asker,
    locale: await getLocale(),
    conversationId: parsed.data.conversationId,
    text: parsed.data.text,
    copy: {
      notInGuides: t("assistant.notInGuides"),
      declined: t("assistant.declined"),
      cutOff: t("assistant.cutOff"),
      // Stored and shown again whenever the chat is reopened, so it cannot promise the question is still in the box.
      failed: t("assistantPage.failedStored"),
      outOfScope: t("assistantPage.outOfScope"),
    },
  });
  if (res.ok) {
    const { usage, ...answered } = res;
    return { ...answered, state: stateFrom(usage, t) };
  }
  // The header is what changed when an allowance ran out or AI went off, so it comes back fresh.
  const changed = res.code === "monthlyLimit" || res.code === "dailyLimit" || res.code === "dormant";
  return { ok: false, code: res.code, error: errorText(t, res), state: changed ? await stateFor(asker, t) : null };
}

export async function listChats(input: { cursor?: string | null }): Promise<ChatListResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const c = cursor.safeParse(input.cursor);
  const page = await listConversations({ asker, cursor: c.success ? (c.data ?? null) : null });
  return { ok: true, ...page };
}

export async function openChat(input: { conversationId: string }): Promise<OpenChatResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const id = uuid.safeParse(input.conversationId);
  const opened = id.success ? await loadConversation({ asker, conversationId: id.data }) : null;
  if (!opened) return { ok: false, error: t("assistantPage.chatNotFound"), missing: true };
  return { ok: true, ...opened };
}

const renameSchema = z.object({ conversationId: uuid, title: z.string().trim().min(1).max(200) });

export async function renameChat(input: { conversationId: string; title: string }): Promise<RenameChatResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistantPage.renameFailed") };
  const res = await renameConversation({ asker, ...parsed.data });
  return res.ok ? { ok: true, title: res.title } : { ok: false, error: t("assistantPage.renameFailed") };
}

export async function deleteChat(input: { conversationId: string }): Promise<PlainResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const id = uuid.safeParse(input.conversationId);
  if (!id.success) return { ok: false, error: t("assistantPage.deleteFailed") };
  const res = await deleteConversation({ asker, conversationId: id.data });
  return res.ok ? { ok: true } : { ok: false, error: t("assistantPage.deleteFailed") };
}

const saveSchema = z.object({ messageId: uuid, saved: z.boolean() });

export async function saveAnswer(input: { messageId: string; saved: boolean }): Promise<SaveAnswerResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistantPage.saveFailed") };
  const res = await setAnswerSaved({ asker, ...parsed.data });
  return res.ok ? { ok: true, savedAt: res.savedAt } : { ok: false, error: t("assistantPage.saveFailed") };
}

export async function listSaved(input: { cursor?: string | null }): Promise<SavedListResult> {
  const { asker, t, demo } = await whoAsks();
  if (demo) return { ok: false, error: t("assistant.notInDemo") };
  const c = cursor.safeParse(input.cursor);
  const page = await listSavedAnswers({ asker, cursor: c.success ? (c.data ?? null) : null });
  return { ok: true, ...page };
}

const rateSchema = z.object({ messageId: uuid, helpful: z.boolean() });

export async function rateChatAnswer(input: { messageId: string; helpful: boolean }): Promise<PlainResult> {
  const { asker, t } = await whoAsks();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistant.feedbackFailed") };
  const res = await rateAnswer({ asker, ...parsed.data });
  return res.ok ? { ok: true } : { ok: false, error: t("assistant.feedbackFailed") };
}
