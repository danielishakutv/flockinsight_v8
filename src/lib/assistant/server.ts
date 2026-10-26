import "server-only";

import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiCall, assistantAnswer, assistantConversation, assistantMessage } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { churchRowHasFeature } from "@/lib/entitlements";
import { isLocale } from "@/lib/i18n/locales";
import { aiReadiness, runAi } from "@/lib/ai/run-ai";
import { scrubFreeText } from "@/lib/ai/safe-text";
import { MODELS } from "@/lib/ai/config";
import { PAYLOAD_CLOSE, PAYLOAD_PREAMBLE } from "@/lib/ai/prompts";
import { AiPayloadRejected, serialise, type SafePayload } from "@/lib/ai/serialiser";
import { loadChurchFactsRaw } from "@/lib/ai/church-facts";
import { toChurchFacts } from "@/lib/ai/church-facts-shared";
import { loadPlatformFactsRaw } from "@/lib/ai/platform-facts";
import { toPlatformFacts } from "@/lib/ai/platform-facts-shared";
import {
  getAdvisorPilot,
  getAdvisorRollout,
  getAiPlatformState,
  getAssistantAllowances,
  getChurchAiSetting,
} from "@/lib/ai/settings";
import {
  ASSISTANT_PROMPT_ID,
  ASSISTANT_SYSTEM_PROMPT,
  BURST_LIMIT,
  CHAT_MAX_TOKENS,
  MAX_CONVERSATION_MESSAGES,
  MAX_QUESTION_CHARS,
  answerKindFor,
  buildAssistantUserTurn,
  conversationTitle,
  groundedFromStored,
  historyForModel,
  isModelFailure,
  parseAnswer,
  reviewStatusFor,
  type AnswerKind,
  type AssistantErrorCode,
  type AssistantMode,
  type AssistantThreadItem,
  type ChatAnswer,
  type ChatQuestion,
  type ReviewStatus,
} from "@/lib/assistant/shared";
import {
  ADVISOR_CHURCH_PROMPT_ID,
  ADVISOR_CHURCH_SYSTEM_PROMPT,
  ADVISOR_FACTS_ACK,
  ADVISOR_MAX_TOKENS,
  ADVISOR_PLATFORM_PROMPT_ID,
  ADVISOR_PLATFORM_SYSTEM_PROMPT,
  CHURCH_NOTES_MAX,
  OUT_OF_SCOPE_COPY_EN,
  advisorEligibility,
  advisorReviewStatusFor,
  advisorRolloutAllows,
  buildAdvisorUserTurn,
  chatUsageFrom,
  dailyAllowanceFor,
  figuresGrounded,
  monthlyAllowanceFor,
  parseAdvisorAnswer,
  type AdvisorUnavailableReason,
  type ChatUsage,
} from "@/lib/assistant/advisor-shared";
import { isOnlyPlaceholders, scrubPatterns } from "@/lib/assistant/scrub";
import { scrubForAsker } from "@/lib/assistant/redact";
import { guideMap, guideSlugs, retrieve, type ApprovedAnswer } from "@/lib/assistant/grounding";
import {
  messageChurchMatch,
  ownedConversation,
  ownedConversations,
  ownerOf,
  type AssistantAsker,
} from "@/lib/assistant/owner";
import {
  claimAssistantQuestion,
  readAssistantUsage,
  refundAssistantQuestion,
  type UsageClaim,
} from "@/lib/assistant/usage";
import { loadConversation, resolveSources } from "@/lib/assistant/chat";

/**
 * The assistant's server core, shared by the church shell and the superadmin
 * shell. It returns CODES, never sentences: the church action translates them
 * with getT(), the superadmin action with englishT(en), so a French cookie
 * never leaks French into the English-only admin.
 *
 * One chat, two modes, and the SERVER picks per question: the advisor (the
 * guides plus the allow-listed figures) when every rule in
 * advisorEligibility holds, otherwise help (the guides alone). The person
 * never chooses, so a role that may not see giving trends cannot ask for
 * them by flipping a switch.
 *
 * Who is asking arrives as an AssistantAsker built once from the session
 * (asker.ts): it decides who pays, whose figures may be sent, whose allowance
 * is counted, and which conversations are theirs.
 */

export type { AssistantScope } from "@/lib/assistant/owner";
export { resolveSources } from "@/lib/assistant/chat";

/** The fixed copy stored for answers the model did not write, in the asker's language. */
export type FixedCopy = {
  notInGuides: string;
  declined: string;
  cutOff: string;
  failed: string;
  /** The advisor declined a question outside church ministry and administration. */
  outOfScope: string;
};

export type AskResult =
  | {
      ok: true;
      conversationId: string;
      /** The conversation's title: set from the first question, or whatever the person renamed it to. */
      title: string;
      question: ChatQuestion;
      answer: ChatAnswer;
      /** The header's figures after this question, so the page need not ask again. */
      usage: ChatUsage;
    }
  | {
      ok: false;
      code: AssistantErrorCode;
      /** tooLong {max}, rateLimited {minutes}, dailyLimit {max}, monthlyLimit {max}. */
      vars?: Record<string, number>;
      /** runAi's reason, when the code is "dormant" or "notSent". */
      reason?: string;
      /** runAi's English message, when the code is "dormant" or "notSent". Logs and superadmin only. */
      message?: string;
    };

/*
 * The help request has to fit FEATURE_POLICY.chat.maxRequestBytes (32 KB) as
 * JSON. The extracts take 12K characters; history is clipped per message and
 * the oldest exchange is dropped until the texts fit under this, measured as
 * UTF-8 JSON (the guides are full of dashes and arrows, three bytes each, and
 * every newline is two). The rest is headroom for the envelope and for
 * runAi's placeholders, which can be longer than what they replace.
 */
const REQUEST_BYTE_BUDGET = 28_000;
/** The same for the advisor, under FEATURE_POLICY.advisor.maxRequestBytes (48 KB): its prompt and figures are bigger. */
const ADVISOR_REQUEST_BYTE_BUDGET = 44_000;
const HISTORY_CLIP = 1_500;
/** What scrubFreeText may keep of a turn. Above both budgets, so it never truncates a prompt we built. */
const TURN_MAX_CHARS = 48_000;

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

/* ============================================================
 * Choosing the mode
 * ========================================================== */

type ModeDecision = {
  mode: AssistantMode;
  reason: AdvisorUnavailableReason | null;
  /** "About our church", already scrubbed and clipped. "" outside the church kinds. */
  churchNotes: string;
};

/**
 * Advisor or help for this asker, right now. Read fresh on every question
 * (the kill switch, a pause, the rollout and the owner's consent all apply
 * to the very next one).
 *
 * The owner's opt-in is read HERE, explicitly: a superadmin acting as a
 * church asks with no church id on the call (it is charged to the platform),
 * so runAi cannot check that church's consent before its figures are sent.
 */
async function decideMode(asker: AssistantAsker): Promise<ModeDecision> {
  const state = await getAiPlatformState();
  const advisorOff = !state.configured || state.killed || state.pausedFeatures.includes("advisor");
  if (asker.kind === "platform") {
    const d = advisorEligibility({
      kind: "platform",
      planAllows: true,
      rolloutAllows: true,
      optedIn: true,
      isDemo: false,
      canReadFigures: asker.canReadFigures,
      advisorOff,
    });
    return { mode: d.mode, reason: d.reason, churchNotes: "" };
  }
  const [setting, rolloutAllows] = await Promise.all([
    getChurchAiSetting(asker.church.id),
    // The rollout is bypassed for a superadmin acting as a church, so an
    // admin can try the advisor on any opted-in church on the right plan.
    asker.kind === "church"
      ? Promise.all([getAdvisorRollout(), getAdvisorPilot()]).then(([rollout, pilot]) =>
          advisorRolloutAllows(rollout, pilot, asker.church.slug),
        )
      : Promise.resolve(true),
  ]);
  const d = advisorEligibility({
    kind: asker.kind,
    planAllows: churchRowHasFeature(asker.church, "aiAdvisor"),
    rolloutAllows,
    optedIn: setting.enabled,
    isDemo: !!asker.church.isDemo,
    canReadFigures: asker.kind === "church" ? asker.canReadFigures : true,
    advisorOff,
  });
  return {
    mode: d.mode,
    reason: d.reason,
    churchNotes: scrubPatterns(setting.notes ?? "").text.trim().slice(0, CHURCH_NOTES_MAX),
  };
}

/** The church whose month is counted and whose id goes on the runAi call: only a church's own staff. */
function billedChurchId(asker: AssistantAsker): string | null {
  return asker.kind === "church" ? asker.church.id : null;
}

/**
 * The page header's figures: which mode the next question gets, why the
 * advisor is not on if it is not, the allowances used, when they reset, and
 * whether AI can run at all. Read-only and free.
 */
export async function getChatUsage(asker: AssistantAsker, now: Date = new Date()): Promise<ChatUsage> {
  const churchId = billedChurchId(asker);
  const [decision, allowances, counts] = await Promise.all([
    decideMode(asker),
    getAssistantAllowances(),
    readAssistantUsage({ churchId, userId: asker.userId, now }),
  ]);
  const ready = await aiReadiness({ churchId, feature: decision.mode === "advisor" ? "advisor" : "chat" });
  return chatUsageFrom({
    kind: asker.kind,
    decision,
    allowances,
    plan: asker.kind === "platform" ? null : asker.church.plan,
    monthUsed: counts.monthUsed,
    dayUsed: counts.dayUsed,
    dormant: "ok" in ready ? { reason: ready.reason, message: ready.message } : null,
    now,
  });
}

/* ============================================================
 * Asking the model: the part askAssistant and the test set share
 * ========================================================== */

/** An earlier row of the conversation. `mode` decides whether it may be replayed (historyForModel). */
type PriorRow = { role: string; content: string; answerKind: string | null; mode: string };

/** Whose figures an advisor answer may use. */
type FiguresFor = { kind: "church"; churchId: string } | { kind: "platform" };

type CoreInput = {
  mode: AssistantMode;
  /** Required when mode is advisor. */
  figures: FiguresFor | null;
  /** The church id on the runAi call: the church's own staff only. Null charges the platform. */
  runAiChurchId: string | null;
  locale: string;
  /** Already scrubbed. */
  question: string;
  prior: PriorRow[];
  churchNotes: string;
  actorUserId: string | null;
  copy: FixedCopy;
};

type CoreOutcome =
  | { sent: false; mode: AssistantMode; reason: string; message: string }
  | {
      sent: true;
      /** The mode that actually answered: the advisor falls back to help when its figures cannot be built. */
      mode: AssistantMode;
      /** runAi's failure reason, or null when the model answered. */
      failure: string | null;
      kind: AnswerKind;
      body: string;
      /** Stored refs: "facts", "guide:<slug>", "answer:<uuid>". */
      sources: string[];
      figuresOk: boolean | null;
      review: ReviewStatus;
      tokens: { input: number | null; output: number | null };
      callId: string | null;
      costNano: number | null;
    };

/**
 * The allow-listed figures, through the serialiser and nowhere else. Null
 * when they cannot be built, which is logged and answered from the guides
 * instead: the answer row then says "help", so nobody is told figures were
 * used when they were not.
 */
async function loadFigures(figures: FiguresFor, locale: string): Promise<SafePayload | null> {
  try {
    if (figures.kind === "church") {
      const raw = await loadChurchFactsRaw(figures.churchId);
      return serialise("church-facts@1", toChurchFacts(raw, isLocale(locale) ? locale : "en"));
    }
    return serialise("platform-facts@1", toPlatformFacts(await loadPlatformFactsRaw()));
  } catch (e) {
    // AiPayloadRejected names the path and the expected kind, never a value.
    console.error("[assistant] figures could not be built; answering from the guides", {
      figures: figures.kind,
      error: e instanceof AiPayloadRejected ? e.message : e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * The earlier exchanges to send. Advisor exchanges only go with an advisor
 * question: a help call carries no figures, not even in its history.
 */
function clipHistory(
  prior: PriorRow[],
  includeAdvisor: boolean,
): { role: "user" | "assistant"; content: string }[] {
  return historyForModel(prior, { includeAdvisor }).map((h) => ({
    role: h.role,
    content: h.content.length > HISTORY_CLIP ? `${h.content.slice(0, HISTORY_CLIP)}…` : h.content,
  }));
}

/** Drops the oldest exchange until the request's texts fit the budget, measured as UTF-8 JSON. */
function fitHistory<T extends { content: string }>(history: T[], fixed: string[], budget: number): T[] {
  let h = history;
  const size = () => Buffer.byteLength(JSON.stringify([...fixed, ...h.map((x) => x.content)]), "utf8");
  while (h.length >= 2 && size() > budget) h = h.slice(2);
  return h;
}

async function answerQuestion(input: CoreInput): Promise<CoreOutcome> {
  const approved = await approvedAnswers();
  const found = retrieve(input.question, approved);
  const known = { guides: guideSlugs(), answers: found.answerCodes };

  const payload = input.mode === "advisor" && input.figures ? await loadFigures(input.figures, input.locale) : null;

  if (payload && input.figures) {
    // The asker was found eligible for these figures for this very question, so earlier advisor answers may go too.
    const history = clipHistory(input.prior, true);
    const system =
      input.figures.kind === "church" ? ADVISOR_CHURCH_SYSTEM_PROMPT : ADVISOR_PLATFORM_SYSTEM_PROMPT;
    const turn = buildAdvisorUserTurn({
      locale: input.locale,
      // Notes are the church's own words: never on a platform question.
      churchNotes: input.figures.kind === "church" ? input.churchNotes : "",
      guideMap: guideMap(),
      extracts: found.extracts,
      question: input.question,
    });
    const fitted = fitHistory(
      history,
      [system, `${PAYLOAD_PREAMBLE}${payload.json}${PAYLOAD_CLOSE}`, ADVISOR_FACTS_ACK, turn],
      ADVISOR_REQUEST_BYTE_BUDGET,
    );
    const result = await runAi({
      churchId: input.runAiChurchId,
      feature: "advisor",
      model: MODELS.haiku,
      promptId: input.figures.kind === "church" ? ADVISOR_CHURCH_PROMPT_ID : ADVISOR_PLATFORM_PROMPT_ID,
      messages: [
        { role: "user" as const, content: payload },
        { role: "assistant" as const, content: scrubFreeText(ADVISOR_FACTS_ACK, TURN_MAX_CHARS) },
        ...fitted.map((h) => ({ role: h.role, content: scrubFreeText(h.content, TURN_MAX_CHARS) })),
        { role: "user" as const, content: scrubFreeText(turn, TURN_MAX_CHARS) },
      ],
      maxTokens: ADVISOR_MAX_TOKENS,
      actorUserId: input.actorUserId,
    });
    if (!result.ok && !isModelFailure(result.reason)) {
      return { sent: false, mode: "advisor", reason: result.reason, message: result.message };
    }

    let kind: AnswerKind;
    let body: string;
    let sources: string[] = [];
    let grounded: boolean | null = null;
    let figuresOk: boolean | null = null;
    if (result.ok) {
      const parsed = parseAdvisorAnswer(result.text, known);
      if (parsed.outOfScope) {
        kind = "out_of_scope";
        body = input.copy.outOfScope;
      } else if (!parsed.body) {
        // An answer whose body was empty is a failed one, whatever it cited.
        kind = "failed";
        body = input.copy.failed;
      } else {
        /*
         * "SOURCES: none" is not "not in the guides" here: a question about
         * ministry practice is answered from the model's own knowledge and
         * legitimately cites nothing. The figure check is what guards it.
         */
        kind = "answered";
        body = parsed.body;
        sources = parsed.sources;
        grounded = parsed.grounded;
        /*
         * A number the model was handed anywhere in the request may be used:
         * a limit quoted from a guide, a target from the church notes, the
         * asker's own "we have 450 members".
         */
        const check = figuresGrounded(body, payload.json, [turn, ...fitted.map((h) => h.content)]);
        figuresOk = check.ok;
        if (!check.ok) {
          // Numbers only, never text: which figures a reviewer should look at.
          console.warn("[assistant] advisor figures not in the data", {
            callId: result.callId,
            unmatched: check.unmatched.slice(0, 20),
          });
        }
      }
    } else {
      kind = answerKindFor({ ok: false, reason: result.reason }, null);
      body = kind === "refused" ? input.copy.declined : kind === "truncated" ? input.copy.cutOff : input.copy.failed;
    }
    return {
      sent: true,
      mode: "advisor",
      failure: result.ok ? null : result.reason,
      kind,
      body,
      sources,
      figuresOk,
      review: advisorReviewStatusFor({ answerKind: kind, figuresOk, helpful: null, grounded }),
      tokens: result.ok
        ? { input: result.usage.inputTokens, output: result.usage.outputTokens }
        : { input: null, output: null },
      callId: result.callId ?? null,
      costNano: result.ok ? result.costNano : null,
    };
  }

  /*
   * Help: the guides alone, prompt and turn exactly as before the advisor
   * existed. Its history leaves out advisor exchanges: this question is help
   * because the asker may not have the figures right now (a plan, a role, the
   * owner's consent), or because they could not be built, and either way an
   * earlier answer must not carry them in by the back door.
   */
  const history = clipHistory(input.prior, false);
  const turn = buildAssistantUserTurn({
    locale: input.locale,
    guideMap: guideMap(),
    extracts: found.extracts,
    question: input.question,
  });
  const fitted = fitHistory(history, [ASSISTANT_SYSTEM_PROMPT, turn], REQUEST_BYTE_BUDGET);
  const result = await runAi({
    churchId: input.runAiChurchId,
    feature: "chat",
    model: MODELS.haiku,
    promptId: ASSISTANT_PROMPT_ID,
    messages: [
      ...fitted.map((h) => ({ role: h.role, content: scrubFreeText(h.content, TURN_MAX_CHARS) })),
      { role: "user" as const, content: scrubFreeText(turn, TURN_MAX_CHARS) },
    ],
    maxTokens: CHAT_MAX_TOKENS,
    actorUserId: input.actorUserId,
  });
  if (!result.ok && !isModelFailure(result.reason)) {
    return { sent: false, mode: "help", reason: result.reason, message: result.message };
  }

  const parsed = result.ok ? parseAnswer(result.text, known) : null;
  const grounded = parsed ? parsed.grounded : null;
  const kind = answerKindFor(result.ok ? { ok: true } : { ok: false, reason: result.reason }, grounded);
  // An answered reply whose body was empty is a failed one, whatever it cited.
  const finalKind: AnswerKind = kind === "answered" && !parsed?.body ? "failed" : kind;
  const fixed: Record<Exclude<AnswerKind, "answered">, string> = {
    not_in_guides: input.copy.notInGuides,
    refused: input.copy.declined,
    truncated: input.copy.cutOff,
    failed: input.copy.failed,
    out_of_scope: input.copy.outOfScope,
  };
  return {
    sent: true,
    mode: "help",
    failure: result.ok ? null : result.reason,
    kind: finalKind,
    body: finalKind === "answered" ? (parsed?.body ?? "") : fixed[finalKind],
    sources: finalKind === "answered" ? (parsed?.sources ?? []) : [],
    figuresOk: null,
    review: reviewStatusFor({ answerKind: finalKind, grounded, helpful: null }),
    tokens: result.ok
      ? { input: result.usage.inputTokens, output: result.usage.outputTokens }
      : { input: null, output: null },
    callId: result.callId ?? null,
    costNano: result.ok ? result.costNano : null,
  };
}

/* ============================================================
 * Asking
 * ========================================================== */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sentinel that rolls back a write when the conversation filled up mid-flight. */
class ConversationFull extends Error {}

/**
 * A question goes back to the allowance unless it got a usable answer or the
 * model declined it: nothing sent, a cut-off answer and a provider error are
 * all handed back. A refund that fails is logged, never thrown over an
 * answer the person is about to see.
 */
async function refund(claim: UsageClaim, why: string): Promise<void> {
  try {
    await refundAssistantQuestion(claim);
  } catch (e) {
    console.error("[assistant] could not hand back a claimed question", {
      why,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function askAssistant(input: {
  asker: AssistantAsker;
  /** The asker's language. The superadmin shell passes "en". */
  locale: string;
  conversationId: string | null;
  text: string;
  copy: FixedCopy;
}): Promise<AskResult> {
  const { asker } = input;
  const owner = ownerOf(asker);
  const text = input.text.trim();
  if (!text) return { ok: false, code: "invalid" };
  if (text.length > MAX_QUESTION_CHARS) {
    return { ok: false, code: "tooLong", vars: { max: MAX_QUESTION_CHARS } };
  }
  // The demo church is shared by strangers and resets every two hours: it never asks.
  if (asker.kind !== "platform" && asker.church.isDemo) return { ok: false, code: "notInDemo" };

  // Only a held-down Enter key; the allowance counter below is the real bound.
  const rl = rateLimit(`assistant:${asker.userId}`, BURST_LIMIT.count, BURST_LIMIT.windowMs);
  if (!rl.ok) {
    return {
      ok: false,
      code: "rateLimited",
      vars: { minutes: Math.max(1, Math.ceil(rl.retryAfterSec / 60)) },
    };
  }

  let conversationId: string | null = null;
  let title: string | null = null;
  let prior: PriorRow[] = [];
  if (input.conversationId && UUID.test(input.conversationId)) {
    const [conv] = await db
      .select({
        id: assistantConversation.id,
        title: assistantConversation.title,
        messageCount: assistantConversation.messageCount,
      })
      .from(assistantConversation)
      .where(ownedConversation(owner, input.conversationId))
      .limit(1);
    // A foreign, unknown or deleted id silently starts a new conversation.
    if (conv) {
      if (conv.messageCount + 2 > MAX_CONVERSATION_MESSAGES) {
        return { ok: false, code: "conversationFull" };
      }
      conversationId = conv.id;
      title = conv.title;
      prior = await db
        .select({
          role: assistantMessage.role,
          content: assistantMessage.content,
          answerKind: assistantMessage.answerKind,
          mode: assistantMessage.mode,
        })
        .from(assistantMessage)
        .where(and(eq(assistantMessage.conversationId, conv.id), messageChurchMatch(owner)))
        // Both rows of an exchange carry the transaction's now(); "user" sorts
        // after "assistant", so the role order is reversed to keep the
        // question first.
        .orderBy(asc(assistantMessage.createdAt), desc(assistantMessage.role))
        .limit(MAX_CONVERSATION_MESSAGES);
    }
  }

  const scrubbed = await scrubForAsker(asker, text);
  if (isOnlyPlaceholders(scrubbed.text)) return { ok: false, code: "onlyPersonalDetails" };

  const [decision, allowances] = await Promise.all([decideMode(asker), getAssistantAllowances()]);
  const billed = billedChurchId(asker);
  const monthlyLimit = asker.kind === "church" ? monthlyAllowanceFor(asker.church.plan, allowances) : null;
  const dailyLimit = dailyAllowanceFor(asker.kind, allowances);

  // Claimed BEFORE the model is asked, atomically (usage.ts).
  const claimed = await claimAssistantQuestion({
    churchId: billed,
    userId: asker.userId,
    monthlyLimit,
    dailyLimit,
  });
  if (!claimed.ok) return { ok: false, code: claimed.code, vars: { max: claimed.limit } };
  const claim = claimed.claim;
  let refunded = false;

  let outcome: CoreOutcome;
  try {
    outcome = await answerQuestion({
      mode: decision.mode,
      figures:
        decision.mode !== "advisor"
          ? null
          : asker.kind === "platform"
            ? { kind: "platform" }
            : { kind: "church", churchId: asker.church.id },
      runAiChurchId: billed,
      locale: input.locale,
      question: scrubbed.text,
      prior,
      churchNotes: decision.churchNotes,
      actorUserId: asker.userId,
      copy: input.copy,
    });
  } catch (e) {
    await refund(claim, "the question threw before an answer");
    throw e;
  }

  if (!outcome.sent) {
    await refund(claim, outcome.reason);
    // Nothing was sent, so nothing is stored. Logged, because a reason we did
    // not expect (invalid_input above all) is a bug to find, not a state.
    console.error("[assistant] not sent", { scope: owner.scope, churchId: billed, reason: outcome.reason });
    /*
     * A request runAi refused on its own terms is not "the assistant is off":
     * saying so would hide the input for the session over one oversized
     * history. It gets its own code, and a new conversation usually fixes it.
     */
    const code =
      outcome.reason === "invalid_input" || outcome.reason === "payload_rejected" ? "notSent" : "dormant";
    return { ok: false, code, reason: outcome.reason, message: outcome.message };
  }
  /*
   * Billed to us, but the person got nothing they can use: a cut-off answer,
   * a provider error, or a reply with nothing in it but a SOURCES line, which
   * is stored as "failed" with failure null because runAi itself succeeded.
   * A model that declined keeps the count (failure "refused", kind
   * "refused"), as does an off-topic reply.
   */
  if (outcome.failure === "truncated" || outcome.failure === "provider_error" || outcome.kind === "failed") {
    await refund(claim, outcome.failure ?? "empty answer");
    refunded = true;
  }

  /*
   * A conversation from before titles existed has none stored: it is named
   * after its FIRST question, as the history list already names it, and that
   * name is written below so it stops changing with every question asked.
   */
  const firstAsked = prior.find((p) => p.role === "user")?.content;
  const newTitle = title ?? conversationTitle(firstAsked ?? scrubbed.text);
  try {
    const written = await db.transaction(async (tx) => {
      let convId = conversationId;
      if (!convId) {
        const [conv] = await tx
          .insert(assistantConversation)
          .values({
            scope: owner.scope,
            churchId: owner.churchId,
            contextChurchId: owner.contextChurchId,
            userId: asker.userId,
            locale: input.locale,
            title: newTitle,
          })
          .returning({ id: assistantConversation.id });
        convId = conv.id;
      }
      const [q] = await tx
        .insert(assistantMessage)
        .values({
          conversationId: convId,
          churchId: owner.churchId,
          userId: asker.userId,
          role: "user",
          content: scrubbed.text,
          redactions: scrubbed.redactions,
          mode: outcome.mode,
        })
        .returning({ id: assistantMessage.id, createdAt: assistantMessage.createdAt });
      const [a] = await tx
        .insert(assistantMessage)
        .values({
          conversationId: convId,
          churchId: owner.churchId,
          userId: asker.userId,
          role: "assistant",
          content: outcome.body,
          answerKind: outcome.kind,
          sources: outcome.sources,
          mode: outcome.mode,
          figuresOk: outcome.figuresOk,
          reviewStatus: outcome.review,
          inputTokens: outcome.tokens.input,
          outputTokens: outcome.tokens.output,
          // The ledger row that holds what was sent, so deleting this chat can clear it too (retention.ts).
          callId: outcome.callId,
        })
        .returning({ id: assistantMessage.id, createdAt: assistantMessage.createdAt });
      /*
       * The ceiling is repeated in the UPDATE so two tabs cannot both take the
       * last slot; a miss rolls the whole exchange back. A missing title is
       * filled here, never an existing one replaced, and the title read back
       * is the stored one as of this row lock: a rename made while the
       * question was with the model is what the page is told, not undone.
       */
      const bumped = await tx
        .update(assistantConversation)
        .set({
          messageCount: sql`${assistantConversation.messageCount} + 2`,
          lastMessageAt: new Date(),
          title: sql`coalesce(${assistantConversation.title}, ${newTitle})`,
        })
        .where(
          and(
            eq(assistantConversation.id, convId),
            lte(assistantConversation.messageCount, MAX_CONVERSATION_MESSAGES - 2),
          ),
        )
        .returning({ id: assistantConversation.id, title: assistantConversation.title });
      if (bumped.length !== 1) throw new ConversationFull();
      return { convId, q, a, title: bumped[0].title ?? newTitle };
    });

    const usage = chatUsageFrom({
      kind: asker.kind,
      decision,
      allowances,
      plan: asker.kind === "platform" ? null : asker.church.plan,
      monthUsed: claim.monthUsed === null ? null : claim.monthUsed - (refunded ? 1 : 0),
      dayUsed: claim.dayUsed - (refunded ? 1 : 0),
      dormant: null,
    });
    return {
      ok: true,
      conversationId: written.convId,
      title: written.title,
      question: {
        role: "user",
        id: written.q.id,
        content: scrubbed.text,
        redactions: scrubbed.redactions,
        mode: outcome.mode,
        createdAt: written.q.createdAt.toISOString(),
      },
      answer: {
        role: "assistant",
        id: written.a.id,
        content: outcome.body,
        kind: outcome.kind,
        sources: resolveSources(outcome.sources),
        helpful: null,
        mode: outcome.mode,
        figuresOk: outcome.figuresOk,
        savedAt: null,
        createdAt: written.a.createdAt.toISOString(),
      },
      usage,
    };
  } catch (e) {
    // The answer was never shown, so the question goes back.
    if (!refunded) await refund(claim, e instanceof ConversationFull ? "conversation full" : "write failed");
    if (e instanceof ConversationFull) return { ok: false, code: "conversationFull" };
    throw e;
  }
}

/* ============================================================
 * The superadmin test set
 * ========================================================== */

/** Fixed copy for a test-set run. Never shown to a church; the grader reads `kind`, not these. */
const EVAL_COPY: FixedCopy = {
  notInGuides: "The guides don't cover this yet.",
  declined: "The model declined this question.",
  cutOff: "The answer ran long and was cut off.",
  failed: "The assistant couldn't answer.",
  outOfScope: OUT_OF_SCOPE_COPY_EN,
};

export type EvalCaseResult =
  | {
      ok: true;
      /** The mode that answered: an advisor case falls back to help if the platform figures cannot be built. */
      mode: AssistantMode;
      kind: AnswerKind;
      body: string;
      /** Stored refs: "facts", "guide:<slug>", "answer:<uuid>". resolveSources() turns them into chips. */
      sources: string[];
      /** Advisor answers only; null otherwise. */
      figuresOk: boolean | null;
      /** What the call cost in nano-USD (0 when the provider failed and charged nothing). */
      costNano: number;
      /** The ai_call row, for /superadmin/ai/calls/<id>. Null only when nothing was sent. */
      callId: string | null;
    }
  | {
      ok: false;
      /** runAi's reason (nothing was sent), or "onlyPersonalDetails" / "invalid". */
      reason: string;
      message: string;
    };

/**
 * One test-set question, asked exactly as a superadmin on /superadmin/ask
 * would ask it (platform scope, the platform's figures for an advisor case,
 * English), through the same prompts, turn builders, runAi and parsing.
 *
 * Nothing is stored as a conversation and no allowance is claimed: a test
 * run must not fill anybody's history or day. It still goes through runAi,
 * so it is on the platform budget and in the ai_call ledger like any call.
 * The caller decides who may run it (platform.assistant.review).
 */
export async function runAssistantEvalCase(input: {
  mode: AssistantMode;
  question: string;
  actorUserId: string | null;
}): Promise<EvalCaseResult> {
  const text = input.question.trim();
  if (!text || text.length > MAX_QUESTION_CHARS) {
    return { ok: false, reason: "invalid", message: `A test question must be 1 to ${MAX_QUESTION_CHARS} characters.` };
  }
  const scrubbed = scrubPatterns(text);
  if (isOnlyPlaceholders(scrubbed.text)) {
    return { ok: false, reason: "onlyPersonalDetails", message: "Nothing was left of the question once personal details were removed." };
  }
  const outcome = await answerQuestion({
    mode: input.mode,
    figures: input.mode === "advisor" ? { kind: "platform" } : null,
    runAiChurchId: null,
    locale: "en",
    question: scrubbed.text,
    prior: [],
    churchNotes: "",
    actorUserId: input.actorUserId,
    copy: EVAL_COPY,
  });
  if (!outcome.sent) return { ok: false, reason: outcome.reason, message: outcome.message };

  let costNano = outcome.costNano;
  if (costNano === null && outcome.callId) {
    // A refused, cut-off or failed call has no cost on runAi's result, but
    // settle() has already written it on the ledger row.
    const [row] = await db
      .select({ costNano: aiCall.costNano })
      .from(aiCall)
      .where(eq(aiCall.id, outcome.callId))
      .limit(1);
    costNano = row?.costNano ?? 0;
  }
  return {
    ok: true,
    mode: outcome.mode,
    kind: outcome.kind,
    body: outcome.body,
    sources: outcome.sources,
    figuresOk: outcome.figuresOk,
    costNano: costNano ?? 0,
    callId: outcome.callId,
  };
}

/* ============================================================
 * The old side panel, and feedback
 * ========================================================== */

/**
 * The conversation the old side panel shows when it opens: the one asked
 * for, or this person's latest from the last 7 days. Kept while the panel is
 * still mounted anywhere; the chat page uses loadConversation and
 * listConversations (chat.ts).
 */
export async function loadThread(input: {
  asker: AssistantAsker;
  conversationId?: string | null;
}): Promise<{ conversationId: string | null; messageCount: number; items: AssistantThreadItem[] }> {
  let id = input.conversationId ?? null;
  if (!id) {
    const [latest] = await db
      .select({ id: assistantConversation.id })
      .from(assistantConversation)
      .where(
        and(
          ownedConversations(ownerOf(input.asker)),
          gt(assistantConversation.lastMessageAt, sql`now() - interval '7 days'`),
        ),
      )
      .orderBy(desc(assistantConversation.lastMessageAt))
      .limit(1);
    id = latest?.id ?? null;
  }
  const loaded = id ? await loadConversation({ asker: input.asker, conversationId: id }) : null;
  if (!loaded) return { conversationId: null, messageCount: 0, items: [] };
  return { conversationId: loaded.conversation.id, messageCount: loaded.conversation.messageCount, items: loaded.items };
}

/**
 * "Did this help?" The message must be an assistant row in a conversation
 * this person owns, in this scope; the UPDATE repeats the church predicate.
 * An advisor answer stays in the review queue while its figures could not be
 * checked, whatever the rating.
 */
export async function rateAnswer(input: {
  asker: AssistantAsker;
  messageId: string;
  helpful: boolean;
}): Promise<{ ok: boolean }> {
  const owner = ownerOf(input.asker);
  const churchMatch = messageChurchMatch(owner);

  const [row] = await db
    .select({
      id: assistantMessage.id,
      answerKind: assistantMessage.answerKind,
      sources: assistantMessage.sources,
      reviewStatus: assistantMessage.reviewStatus,
      mode: assistantMessage.mode,
      figuresOk: assistantMessage.figuresOk,
    })
    .from(assistantMessage)
    .innerJoin(assistantConversation, eq(assistantConversation.id, assistantMessage.conversationId))
    .where(
      and(
        eq(assistantMessage.id, input.messageId),
        eq(assistantMessage.role, "assistant"),
        ownedConversations(owner),
        churchMatch,
      ),
    )
    .limit(1);
  if (!row) return { ok: false };

  const kind = (row.answerKind ?? "failed") as AnswerKind;
  const reviewStatus =
    row.mode === "advisor"
      ? advisorReviewStatusFor({
          answerKind: kind,
          figuresOk: row.figuresOk,
          helpful: input.helpful,
          current: row.reviewStatus,
        })
      : reviewStatusFor({
          answerKind: kind,
          grounded: groundedFromStored(kind, row.sources ?? []),
          helpful: input.helpful,
          current: row.reviewStatus,
        });
  const updated = await db
    .update(assistantMessage)
    .set({ helpful: input.helpful, feedbackAt: new Date(), reviewStatus })
    .where(and(eq(assistantMessage.id, row.id), churchMatch))
    .returning({ id: assistantMessage.id });
  return { ok: updated.length === 1 };
}
