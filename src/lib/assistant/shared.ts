/**
 * The assistant's pure half: limits, the help prompt text, and the rules for
 * reading an answer back. Client-safe and database-free, so the chat page can
 * use the constants and vitest can pin every rule.
 *
 * The assistant answers in one of two modes, and the server picks which for
 * each question:
 *
 *   help     "how do I use FlockInsight", from lib/help/** and from canned
 *            answers a human approved. It sees no church records. Everything
 *            in THIS file is the help half, and nothing here takes a church
 *            as an argument, so nothing here can put one in a prompt.
 *   advisor  help plus the church's (or the platform's) allow-listed figures,
 *            counts and percentages only, through the serialiser. Its prompt,
 *            its user turn and its parsing live in advisor-shared.ts, so the
 *            figures can never be threaded into the help prompt by accident.
 */
import { isLocale, localeInfo } from "@/lib/i18n/locales";

export const MAX_QUESTION_CHARS = 1000;
/** User and assistant rows together. 15 questions, then start a new one. */
export const MAX_CONVERSATION_MESSAGES = 30;
/** Rows of earlier conversation sent with a question: three exchanges. */
export const HISTORY_TURNS = 6;
/**
 * In-memory and therefore per worker. The allowance counter (usage.ts) is
 * the real bound; this only stops a held-down Enter key from reaching it in a
 * second.
 */
export const BURST_LIMIT = { count: 20, windowMs: 600_000 } as const;
/**
 * @deprecated The old rolling 24-hour count. Nothing enforces it any more:
 * the per-person daily allowance in lib/entitlements.ts (ASSISTANT_PERSON_DAILY,
 * ASSISTANT_ADMIN_DAILY), claimed atomically in usage.ts, replaced it.
 */
export const DAILY_QUESTIONS = 60;
/**
 * Promised to churches in the privacy line; the assistant-retention cron keeps
 * it. A conversation with a saved answer in it is kept until the person
 * deletes it or unsaves the answer.
 */
export const ASSISTANT_RETENTION_DAYS = 180;
/** A conversation the person deleted is hidden at once and gone for good this many days later. */
export const ASSISTANT_DELETED_PURGE_DAYS = 30;
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

/**
 * "out_of_scope" is the advisor declining a question outside church ministry
 * and administration (sport, coding, politics, medical advice). It is stored
 * so the person sees what happened, and never opens a review item: off-topic
 * traffic must not flood the queue.
 */
export type AnswerKind = "answered" | "not_in_guides" | "refused" | "truncated" | "failed" | "out_of_scope";
export type ReviewStatus = "none" | "open" | "dismissed" | "resolved";

/** Which half answered: the guides alone, or the guides plus the figures. */
export type AssistantMode = "help" | "advisor";

export type AssistantErrorCode =
  | "tooLong"
  | "rateLimited"
  /** The person's allowance for today (UTC) is used. vars.max is the allowance. */
  | "dailyLimit"
  /** The church's allowance for this month (UTC) is used. vars.max is the allowance. */
  | "monthlyLimit"
  | "conversationFull"
  | "onlyPersonalDetails"
  | "notInDemo"
  | "dormant"
  /** runAi refused the request itself (too big, malformed): nothing was sent, but AI is not off. */
  | "notSent"
  | "invalid";

/** What the panel renders for a source chip. */
export type AssistantSource = { ref: string; title: string; href: string | null };

/** A stored question as the chat page sees it. Dates are ISO strings, safe to hand to a client. */
export type ChatQuestion = {
  role: "user";
  id: string;
  /** The SCRUBBED question: what was sent and stored, not what was typed. */
  content: string;
  redactions: number;
  mode: AssistantMode;
  createdAt: string;
};

/** A stored answer as the chat page sees it. */
export type ChatAnswer = {
  role: "assistant";
  id: string;
  content: string;
  kind: AnswerKind;
  sources: AssistantSource[];
  helpful: boolean | null;
  mode: AssistantMode;
  /**
   * Advisor answers: whether every figure in the answer was found in the
   * figures the model was given. False shows "Some figures could not be
   * checked against your records." Null for help answers.
   */
  figuresOk: boolean | null;
  /** When the person saved it, or null. Saved answers outlive the retention sweep. */
  savedAt: string | null;
  createdAt: string;
  /**
   * An advisor answer written from figures this person may no longer read
   * (their role was narrowed after they asked). The server sent it with no
   * content and no sources, and the page says why instead of showing it.
   */
  withheld?: true;
};

export type ChatItem = ChatQuestion | ChatAnswer;

/** One row of the history list. */
export type ConversationSummary = {
  id: string;
  /** The stored title, or the first question for a conversation from before titles. Never null. */
  title: string;
  messageCount: number;
  /** Answers in it the person saved. */
  savedCount: number;
  startedAt: string;
  lastMessageAt: string;
};

/** A conversation opened on the page. */
export type ConversationDetail = {
  id: string;
  title: string;
  messageCount: number;
  /** No room for another exchange: the page offers a new conversation instead. */
  full: boolean;
  locale: string;
  startedAt: string;
  lastMessageAt: string;
  /**
   * Platform scope only: the church a superadmin was acting as when they
   * asked, so the page can say whose figures the answers were about. Null on
   * /superadmin and in every church conversation.
   */
  contextChurch: { id: string; name: string } | null;
};

/** One entry on the "Saved" tab: the answer, the question it answered, and where it came from. */
export type SavedAnswer = {
  conversationId: string;
  conversationTitle: string;
  /** The latest question at or before the answer. Null only if that row is somehow gone. */
  question: ChatQuestion | null;
  answer: ChatAnswer;
};

/**
 * The question each answer answered, in order: the latest question at or
 * before the answer. Both rows of an exchange share one timestamp and arrive
 * question first (createdAt asc, role desc), so walking the list is enough.
 * For a download, one exchange per answer.
 */
export function exchangesOf(items: readonly ChatItem[]): { question: ChatQuestion | null; answer: ChatAnswer }[] {
  const out: { question: ChatQuestion | null; answer: ChatAnswer }[] = [];
  let question: ChatQuestion | null = null;
  for (const item of items) {
    if (item.role === "user") question = item;
    else out.push({ question, answer: item });
  }
  return out;
}

/**
 * One stored row as the old side panel sees it. Its question shape is the
 * original one (the panel builds it locally from the typed text); its answer
 * is the full ChatAnswer.
 */
export type AssistantThreadItem =
  | {
      role: "user";
      id: string;
      content: string;
      redactions: number;
    }
  | ChatAnswer;

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

/** "French (Français)" for a known locale, "English" for anything else. Shared with the advisor's turn. */
export function languageLine(locale: string): string {
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
 *
 * `facts` counts as a real source only when opts.facts is set: the advisor
 * cites the figures it was given that way, and the help assistant was given
 * none, so from a help answer the token means nothing and is dropped.
 */
export function parseAnswer(
  text: string,
  known: KnownSources,
  opts: { facts?: boolean } = {},
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
    if (opts.facts && /^facts$/i.test(ref)) {
      if (!sources.includes("facts")) sources.push("facts");
      continue;
    }
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

/** The most a conversation title holds, from the first question or a rename. */
export const CONVERSATION_TITLE_MAX = 80;

/**
 * A conversation's title until the person renames it: the first 80
 * characters of the first (scrubbed) question, on one line.
 */
export function conversationTitle(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, CONVERSATION_TITLE_MAX).trimEnd();
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
  // Off-topic is a correct answer, not a gap in the guides.
  if (input.answerKind === "out_of_scope") return "none";
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
 *
 * An advisor answer carries the figures it was written from (attendance and
 * follow-up counts, the giving trend), so it is replayed only into another
 * advisor question, which the asker was just found eligible for. A help
 * question is asked when that eligibility is gone (the owner withdrew
 * consent, a role lost giving, an admin lost the dashboard permission) or
 * was never there, and the figures must not ride along in its history:
 * includeAdvisor is off unless the caller says otherwise. The whole exchange
 * goes, question and answer, so the pairing stays intact.
 */
export function historyForModel(
  rows: { role: string; content: string; answerKind: string | null; mode?: string | null }[],
  opts: { includeAdvisor?: boolean } = {},
): { role: "user" | "assistant"; content: string }[] {
  const pairs: { role: "user" | "assistant"; content: string }[][] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const q = rows[i];
    const a = rows[i + 1];
    if (q.role !== "user" || a.role !== "assistant") continue;
    if (a.answerKind !== "answered" && a.answerKind !== "not_in_guides") continue;
    if (a.mode === "advisor" && !opts.includeAdvisor) {
      i++;
      continue;
    }
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
