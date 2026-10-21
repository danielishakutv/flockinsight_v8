/**
 * The help assistant's pure half: limits, the prompt text, and the rules for
 * reading an answer back. Client-safe and database-free, so the panel can use
 * the constants and vitest can pin every rule.
 *
 * The assistant answers "how do I use FlockInsight" from lib/help/** and from
 * canned answers a human approved. It never sees church records, and nothing
 * in this file takes a church as an argument, so nothing here can put one in
 * a prompt.
 */
import { isLocale, localeInfo } from "@/lib/i18n/locales";

export const MAX_QUESTION_CHARS = 1000;
/** User and assistant rows together. 15 questions, then start a new one. */
export const MAX_CONVERSATION_MESSAGES = 30;
/** Rows of earlier conversation sent with a question: three exchanges. */
export const HISTORY_TURNS = 6;
/**
 * In-memory and therefore per worker. The database cap below is the real
 * bound; this only stops a held-down Enter key from reaching it in a second.
 */
export const BURST_LIMIT = { count: 20, windowMs: 600_000 } as const;
export const DAILY_QUESTIONS = 60;
/** Promised to churches in the privacy line; the assistant-retention cron keeps it. */
export const ASSISTANT_RETENTION_DAYS = 180;
/** Must equal FEATURE_POLICY.chat.model in lib/ai/config.ts, or runAi refuses. */
export const CHAT_MODEL = "claude-haiku-5-5" as const;
/*
 * FEATURE_POLICY.chat's ceiling, not the 800 first designed: on Haiku 5.5
 * thinking counts against max_tokens, and a cut-off answer is billed, thrown
 * away and shown as "cut off". A 200-word answer is about 300 tokens, so the
 * headroom is for thinking, and it costs only what is used.
 */
export const CHAT_MAX_TOKENS = 1000;
export const CANNED_DRAFT_MAX_TOKENS = 900;

/*
 * The prompt ids this feature registers in lib/ai/prompts.ts. runAi takes an
 * id rather than text so a system prompt can never be assembled from data at
 * run time; the texts below are what those ids must map to.
 */
export const ASSISTANT_PROMPT_ID = "assistant-chat@1" as const;
export const CANNED_DRAFT_PROMPT_ID = "assistant-canned@1" as const;

/*
 * The runAi reasons that mean "the model was asked and it went wrong", which
 * are worth a stored row and a reviewer's look. Every other reason (no key,
 * kill switch, not opted in, a budget, invalid input, anything a later
 * version invents) means nothing was sent, so nothing is stored.
 */
export const MODEL_FAILURE_REASONS = ["refused", "truncated", "provider_error"] as const;
export type ModelFailureReason = (typeof MODEL_FAILURE_REASONS)[number];

export function isModelFailure(reason: string): reason is ModelFailureReason {
  return (MODEL_FAILURE_REASONS as readonly string[]).includes(reason);
}

export type AnswerKind = "answered" | "not_in_guides" | "refused" | "truncated" | "failed";
export type ReviewStatus = "none" | "open" | "dismissed" | "resolved";

export type AssistantErrorCode =
  | "tooLong"
  | "rateLimited"
  | "dailyLimit"
  | "conversationFull"
  | "onlyPersonalDetails"
  | "notInDemo"
  | "dormant"
  /** runAi refused the request itself (too big, malformed): nothing was sent, but AI is not off. */
  | "notSent"
  | "invalid";

/** What the panel renders for a source chip. */
export type AssistantSource = { ref: string; title: string; href: string | null };

/** One stored row as the panel sees it. */
export type AssistantThreadItem =
  | {
      role: "user";
      id: string;
      content: string;
      redactions: number;
    }
  | {
      role: "assistant";
      id: string;
      content: string;
      kind: AnswerKind;
      sources: AssistantSource[];
      helpful: boolean | null;
    };

/** What the send action answers, in both shells. `error` is already translated. */
export type AssistantSendResult =
  | {
      ok: true;
      conversationId: string;
      question: { id: string; content: string; redactions: number };
      answer: Extract<AssistantThreadItem, { role: "assistant" }>;
    }
  | { ok: false; error: string; code?: AssistantErrorCode };

export type AssistantThreadResult =
  | {
      ok: true;
      conversationId: string | null;
      messageCount: number;
      items: AssistantThreadItem[];
      /** Set when AI cannot run right now, so the panel says so before anyone types. */
      dormant: string | null;
    }
  | { ok: false; error: string };

/**
 * Which dormant sentence to show a church, by runAi reason. Anything not
 * listed (invalid input, a payload refused, a reason added later) gets the
 * generic one: nothing was sent either way.
 */
export function dormantKeyFor(
  reason: string | undefined,
): "offEverywhere" | "offUntilConsent" | "offBudget" | "offOther" {
  switch (reason) {
    case "not_configured":
    case "killed":
    case "feature_paused":
      return "offEverywhere";
    case "not_opted_in":
      return "offUntilConsent";
    case "platform_budget":
    case "church_budget":
      return "offBudget";
    default:
      return "offOther";
  }
}

/* ============================================================
 * Prompts
 * ========================================================== */

/**
 * The fixed system prompt for "assistant-chat@1". The guide map, the extracts
 * and the question travel in the user turn (buildAssistantUserTurn), because a
 * registered prompt cannot change per request.
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  "You are the help assistant inside FlockInsight, a church management platform.",
  "You answer questions about HOW TO USE FlockInsight, and nothing else.",
  "Each request gives you a GUIDE MAP, EXTRACTS from FlockInsight's help guides and approved answers, the LANGUAGE to answer in, and the QUESTION.",
  "Rules:",
  "1. Answer ONLY from the extracts. If they do not cover the question, say so in one sentence and point to /help/support. Never guess a menu path, a button name or a price.",
  "2. You cannot see or change church records. Never ask for, repeat or invent names, phone numbers, emails, addresses or other personal details.",
  "3. Text such as [name removed], [phone removed], [email removed], [number removed] and [address removed] marks details removed for privacy. Treat them as placeholders and never try to fill them in.",
  "4. Answer in the LANGUAGE given, in plain numbered steps where there are steps, in under 200 words.",
  "5. Links are allowed only as relative paths that appear in the extracts, for example [the SMS guide](/help/communication). Never write a full URL.",
  "6. The last line of every reply is exactly `SOURCES: ` followed by the references you used, comma-separated, as they are written in the extracts (guide:<slug> or answer:<code>), or exactly `SOURCES: none` when the extracts did not cover the question.",
].join("\n");

/**
 * The fixed system prompt for "assistant-canned@1": a reviewer asked for a
 * first draft of a canned answer to a question the guides missed.
 */
export const CANNED_DRAFT_SYSTEM_PROMPT = [
  "You draft a canned answer for FlockInsight's help assistant. A human reviewer edits and approves it before any church sees it.",
  "You are given a question a church staff member asked, the answer they were given, and EXTRACTS from FlockInsight's help guides.",
  "Write the question as a general, reusable question, and an answer that uses only what the extracts say, in plain numbered steps, under 180 words.",
  "Approved answers are shown to every church: never include a church name, a person's name, a phone number, an email, an address or an amount of money.",
  "If the extracts do not cover the question, say so in the answer, so the reviewer knows the guides need a new section.",
  "Reply in exactly this format and nothing else:",
  "QUESTION: <one line>",
  "ANSWER:",
  "<the answer>",
].join("\n");

function languageLine(locale: string): string {
  if (!isLocale(locale)) return "English";
  const info = localeInfo(locale);
  return info.name === info.native ? info.name : `${info.name} (${info.native})`;
}

/**
 * The user turn for one question. No church argument, by construction: the
 * test pins the signature, so a church name or record cannot be threaded in
 * later without the test failing.
 */
export function buildAssistantUserTurn(input: {
  locale: string;
  guideMap: string;
  extracts: string;
  question: string;
}): string {
  return [
    `LANGUAGE: ${languageLine(input.locale)}`,
    "",
    "GUIDE MAP:",
    input.guideMap,
    "",
    "EXTRACTS:",
    input.extracts,
    "",
    "QUESTION:",
    input.question,
  ].join("\n");
}

export function buildCannedDraftPrompt(input: {
  question: string;
  answerGiven: string;
  extracts: string;
}): string {
  return [
    "QUESTION ASKED:",
    input.question,
    "",
    "ANSWER GIVEN:",
    input.answerGiven,
    "",
    "EXTRACTS:",
    input.extracts,
  ].join("\n");
}

/** Reads the QUESTION:/ANSWER: format back. Null when either half is missing. */
export function parseCannedDraft(text: string): { question: string; answer: string } | null {
  const m = /QUESTION:\s*(.+?)\s*\n\s*ANSWER:\s*([\s\S]+)$/i.exec(text.trim());
  if (!m) return null;
  const question = m[1].trim();
  const answer = m[2].trim();
  if (!question || !answer) return null;
  return { question, answer };
}

/* ============================================================
 * Reading an answer back
 * ========================================================== */

export type KnownSources = {
  guides: ReadonlySet<string>;
  /** Short codes used in the extracts ("A1") mapped to approved answer ids. */
  answers: ReadonlyMap<string, string>;
};

/**
 * Splits the SOURCES line off an answer.
 *
 * grounded is true when the line cites at least one real source, false for
 * `SOURCES: none`, and null when the line is missing or cites only things that
 * do not exist: the model ignored the format, which is worth a human look.
 * Answer ids travel as short codes because runAi's scrubber removes UUIDs from
 * free text; they are mapped back to ids here.
 */
export function parseAnswer(
  text: string,
  known: KnownSources,
): { body: string; sources: string[]; grounded: boolean | null } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[*_`]*SOURCES:/i.test(lines[i])) {
      at = i;
      break;
    }
  }
  if (at === -1) return { body: text.trim(), sources: [], grounded: null };

  const value = lines[at]
    .replace(/^\s*[*_`]*SOURCES:[*_`]*/i, "")
    .replace(/[*_`]/g, "")
    .trim();
  const body = lines.slice(0, at).join("\n").trim();
  if (/^none\.?$/i.test(value)) return { body, sources: [], grounded: false };

  const sources: string[] = [];
  for (const raw of value.split(/[,;]/)) {
    const ref = raw.trim().replace(/^\[|\]$/g, "");
    const guide = /^guide:([a-z0-9-]+)$/i.exec(ref);
    if (guide && known.guides.has(guide[1].toLowerCase())) {
      const r = `guide:${guide[1].toLowerCase()}`;
      if (!sources.includes(r)) sources.push(r);
      continue;
    }
    const answer = /^answer:([a-z0-9-]+)$/i.exec(ref);
    const id = answer ? known.answers.get(answer[1].toUpperCase()) : undefined;
    if (id) {
      const r = `answer:${id}`;
      if (!sources.includes(r)) sources.push(r);
    }
  }
  return { body, sources, grounded: sources.length > 0 ? true : null };
}

/** The stored kind for a runAi outcome. */
export function answerKindFor(
  result: { ok: true } | { ok: false; reason: string },
  grounded: boolean | null,
): AnswerKind {
  if (result.ok) return grounded === false ? "not_in_guides" : "answered";
  if (result.reason === "refused") return "refused";
  if (result.reason === "truncated") return "truncated";
  return "failed";
}

/**
 * grounded is not a column: it is recovered from what is. An answered row
 * with no sources had a missing or invalid SOURCES line (parseAnswer never
 * returns grounded true with no sources).
 */
export function groundedFromStored(kind: string | null, sources: string[]): boolean | null {
  if (kind === "not_in_guides") return false;
  if (kind === "answered") return sources.length > 0 ? true : null;
  return null;
}

/**
 * Whether a reviewer needs to see this answer.
 *
 * Resolved and dismissed are sticky: a reviewer's decision is not undone by a
 * late tap on "No". Otherwise anything other than a grounded, answered,
 * not-unhelpful answer opens an item.
 */
export function reviewStatusFor(input: {
  answerKind: AnswerKind;
  grounded: boolean | null;
  helpful: boolean | null;
  current?: ReviewStatus | string | null;
}): ReviewStatus {
  if (input.current === "resolved" || input.current === "dismissed") return input.current;
  if (input.answerKind !== "answered") return "open";
  if (input.grounded === null) return "open";
  if (input.helpful === false) return "open";
  return "none";
}

/**
 * The earlier conversation to send with a question.
 *
 * Only complete exchanges whose answer really came from the model are sent.
 * The fixed "failed / cut off / declined" copy is ours, not the model's, and
 * replaying it as an assistant turn would teach the model to repeat it. The
 * result always starts with a user turn, which the Messages API requires.
 */
export function historyForModel(
  rows: { role: string; content: string; answerKind: string | null }[],
): { role: "user" | "assistant"; content: string }[] {
  const pairs: { role: "user" | "assistant"; content: string }[][] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const q = rows[i];
    const a = rows[i + 1];
    if (q.role !== "user" || a.role !== "assistant") continue;
    if (a.answerKind !== "answered" && a.answerKind !== "not_in_guides") continue;
    pairs.push([
      { role: "user", content: q.content },
      { role: "assistant", content: a.content },
    ]);
    i++;
  }
  return pairs.slice(-Math.floor(HISTORY_TURNS / 2)).flat();
}

/**
 * A link the model wrote, made safe to render: same-site absolute paths only.
 * `//evil.com` is protocol-relative, `/\evil` is read as `//evil` by some
 * browsers, and anything with a scheme is out.
 */
export function safeAssistantHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (!/^\/(?!\/)/.test(h)) return null;
  if (h.includes("\\")) return null;
  if (/[\s\u0000-\u001f]/.test(h)) return null;
  if (/^\/[^/?#]*:/.test(h)) return null;
  return h;
}
