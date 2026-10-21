"use server";

import { z } from "zod";
import { requireChurch } from "@/lib/session";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { getLocale, getT } from "@/lib/i18n/server";
import { aiReadiness } from "@/lib/ai/run-ai";
import type { TFunction } from "@/lib/i18n/translate";
import {
  MAX_QUESTION_CHARS,
  dormantKeyFor,
  type AssistantSendResult,
  type AssistantThreadResult,
} from "@/lib/assistant/shared";
import {
  askAssistant,
  loadThread,
  rateAnswer,
  type AskResult,
  type AssistantScope,
} from "@/lib/assistant/server";

/*
 * The help assistant, from the church shell. Any staff login may ask, exactly
 * as /help is open to any staff login, so no church permission key gates it.
 *
 * Who pays is decided here. A superadmin acting as a church is support, not
 * the church: their questions are filed under the platform scope and charged
 * to the platform budget, never to the church's share. The demo church is
 * shared by strangers and resets every two hours, so it never asks at all.
 */

async function whoAsks() {
  const { user, church, impersonating } = await requireChurch();
  const scope: AssistantScope = impersonating ? "platform" : "church";
  return {
    user,
    church,
    scope,
    churchId: scope === "church" ? church.id : null,
  };
}

function errorText(t: TFunction, r: Extract<AskResult, { ok: false }>): string {
  switch (r.code) {
    case "dormant":
      return `${t("assistant.turnedOff")} ${t(`assistant.${dormantKeyFor(r.reason)}`)}`;
    case "tooLong":
      return t("assistant.tooLong", r.vars);
    case "rateLimited":
      return t("assistant.rateLimited", r.vars);
    case "dailyLimit":
      return t("assistant.dailyLimit", r.vars);
    case "conversationFull":
      return t("assistant.conversationFull");
    case "onlyPersonalDetails":
      return t("assistant.onlyPersonalDetails");
    case "notInDemo":
      return t("assistant.notInDemo");
    case "notSent":
      return t("assistant.offOther");
    case "invalid":
      return t("assistant.tooLong", { max: MAX_QUESTION_CHARS });
  }
}

const sendSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});

export async function sendAssistantMessage(input: {
  conversationId?: string | null;
  text: string;
}): Promise<AssistantSendResult> {
  const who = await whoAsks();
  const t = await getT();
  if (who.church.isDemo) {
    return { ok: false, code: "notInDemo", error: t("assistant.notInDemo") };
  }
  const gate = await refuseWithoutFeature("assistant");
  if (gate) return { ok: false, error: gate.error };

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "tooLong",
      error: t("assistant.tooLong", { max: MAX_QUESTION_CHARS }),
    };
  }

  const res = await askAssistant({
    scope: who.scope,
    churchId: who.churchId,
    userId: who.user.id,
    userName: who.user.name ?? "",
    churchName: who.church.name,
    locale: await getLocale(),
    conversationId: parsed.data.conversationId ?? null,
    text: parsed.data.text,
    copy: {
      notInGuides: t("assistant.notInGuides"),
      declined: t("assistant.declined"),
      cutOff: t("assistant.cutOff"),
      failed: t("assistant.failed"),
    },
  });
  if (!res.ok) return { ok: false, code: res.code, error: errorText(t, res) };
  return res;
}

export async function getAssistantThread(input: {
  conversationId?: string | null;
}): Promise<AssistantThreadResult> {
  const who = await whoAsks();
  const t = await getT();
  if (who.church.isDemo) return { ok: false, error: t("assistant.notInDemo") };
  const id = z.string().uuid().nullable().optional().safeParse(input.conversationId);
  const [thread, ready] = await Promise.all([
    loadThread({
      scope: who.scope,
      churchId: who.churchId,
      userId: who.user.id,
      conversationId: id.success ? (id.data ?? null) : null,
    }),
    // Read-only: no claim, no budget. Lets the panel say "turned off" on open.
    aiReadiness({ churchId: who.churchId, feature: "chat" }),
  ]);
  const dormant =
    "ready" in ready
      ? null
      : `${t("assistant.turnedOff")} ${t(`assistant.${dormantKeyFor(ready.reason)}`)}`;
  return { ok: true, ...thread, dormant };
}

const rateSchema = z.object({ messageId: z.string().uuid(), helpful: z.boolean() });

export async function rateAssistantAnswer(input: {
  messageId: string;
  helpful: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const who = await whoAsks();
  const t = await getT();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("assistant.feedbackFailed") };
  const res = await rateAnswer({
    scope: who.scope,
    churchId: who.churchId,
    userId: who.user.id,
    messageId: parsed.data.messageId,
    helpful: parsed.data.helpful,
  });
  return res.ok ? { ok: true } : { ok: false, error: t("assistant.feedbackFailed") };
}
