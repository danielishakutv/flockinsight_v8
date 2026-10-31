/**
 * The fixed system prompts, by id.
 *
 * runAi takes a PromptId and looks the text up here, so a system prompt can
 * never be assembled from church data at runtime. A prompt that changes gets
 * a new id ("@2") rather than an edit, because ai_call.promptId records which
 * one a call used and an edited "@1" would make that record lie.
 *
 * Other AI features add their prompts to this registry. Pure.
 */

import { ASSISTANT_SYSTEM_PROMPT, CANNED_DRAFT_SYSTEM_PROMPT } from "@/lib/assistant/shared";
import { ADVISOR_CHURCH_SYSTEM_PROMPT, ADVISOR_PLATFORM_SYSTEM_PROMPT } from "@/lib/assistant/advisor-shared";
import { BLOG_DRAFT_SYSTEM_PROMPT } from "@/lib/blog-draft-shared";

const SHARED_RULES =
  "Use only figures that appear in the JSON. Never invent or estimate a number, name, date or cause. " +
  "Say rates as percentages. A null value means too few records: say so plainly instead of guessing. " +
  "No markdown, headings or lists apart from the Suggestion line.";

export const PROMPTS = Object.freeze({
  "analytics-church@1":
    "You write a short briefing for a church's leaders from a JSON object of aggregate figures. " +
    "The JSON holds only counts, 0–1 rates, percentage changes and indices. It describes no individual person. " +
    "Write in the language named by meta.locale. " +
    "Write four to six short sentences in plain words a pastor would use, then one practical suggestion on its own line beginning 'Suggestion:'. " +
    "Use only figures that appear in the JSON. Never invent or estimate a number, name, date or cause. " +
    "Say rates as percentages. " +
    "giving.monthlyIndex is relative (the first month with giving = 100). Describe its direction and size, never an amount of money. " +
    "A null value means too few records: say so plainly instead of guessing. " +
    "If attendance.weeksWithRecords is below 4, open by saying the picture is still early. " +
    "No markdown, headings or lists apart from the Suggestion line.",
  "analytics-platform@1":
    "You write a short briefing for the operator of FlockInsight, a church-management platform, from a JSON object of aggregate platform figures. " +
    "The JSON holds only counts, 0–1 rates, percentage changes and the names of product areas. It names no church and no person. " +
    "Write in English. " +
    "Write four to six short sentences in plain business language, then one practical suggestion on its own line beginning 'Suggestion:'. " +
    "Revenue appears only as percentage changes and shares: never state or estimate an amount of money. " +
    "When churches.total is under 30, say that the trends rest on a small number of churches. " +
    SHARED_RULES,
  "finance-platform@1":
    "You advise the operator of FlockInsight, a church-management platform, on whether the business makes money, from a JSON object of aggregate figures for meta.period. " +
    "The JSON holds only counts, 0–1 shares, whole percentages, one index and trend words. It names no church, person, supplier or amount of money. " +
    "Write in English. " +
    "Write three to five short sentences in plain business language: whether the business is profitable and by what margin, what drives its costs (the largest costShare entries), how its revenue is made, and the unit economics where they are not null. " +
    "Then write two or three practical actions, each on its own line beginning 'Suggestion:'. " +
    "costShare and revenueShare are fractions of total cost and of total revenue. " +
    "unitEconomics.lifetimeValueToAcquisitionIndex is what a paying church is worth over its lifetime as a percentage of what it costs to win one: 300 means three times. " +
    "planMarginPct is each plan's margin after the cost of serving its churches. " +
    "Never state or estimate an amount of money: speak in shares, percentages, counts and directions. " +
    "When churches.paying is under 10, say that the figures rest on few paying churches. " +
    SHARED_RULES,
  /*
   * The help assistant and the blog drafter keep their texts beside the code
   * that parses the replies, so one test pins both halves. The ids live here,
   * so runAi can still only ever send a registered text. The blog prompt
   * lists FORBIDDEN_CLAIMS: changing that list changes the prompt, and the id
   * should be bumped with it.
   */
  "assistant-chat@1": ASSISTANT_SYSTEM_PROMPT,
  "assistant-canned@1": CANNED_DRAFT_SYSTEM_PROMPT,
  "blog-draft@1": BLOG_DRAFT_SYSTEM_PROMPT,
  /*
   * The advisor: the help assistant plus allow-listed figures. Its texts sit
   * beside its OUT_OF_SCOPE / SOURCES parser and figure check in
   * lib/assistant/advisor-shared.ts, for the same reason as the help prompt.
   */
  "assistant-advisor-church@1": ADVISOR_CHURCH_SYSTEM_PROMPT,
  "assistant-advisor-platform@1": ADVISOR_PLATFORM_SYSTEM_PROMPT,
} as const);

export type PromptId = keyof typeof PROMPTS;

export function isPromptId(v: unknown): v is PromptId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PROMPTS, v);
}

/**
 * Prompts that only make sense for one kind of subject. Analytics serves both
 * a church and the platform, so the feature cannot say whether a church id
 * belongs on the call; the prompt can. A church briefing without a church
 * would skip the opt-in check, and a platform briefing with one would charge
 * that church's budget for the operator's question.
 */
export const PROMPT_SCOPE: Readonly<Partial<Record<PromptId, "church" | "platform">>> =
  Object.freeze({
    "analytics-church@1": "church",
    "analytics-platform@1": "platform",
    "finance-platform@1": "platform",
    // A canned-answer draft and a blog post are the platform's own work and
    // must never be charged to a church. A help question can be either.
    // Neither advisor prompt is scoped: a superadmin acting as a church asks
    // the church advisor with no church id (charged to the platform), so the
    // caller checks that church's opt-in itself before sending its figures.
    "assistant-canned@1": "platform",
    "blog-draft@1": "platform",
  });

/** The only framing runAi puts around a validated payload. Fixed strings, nothing else. */
export const PAYLOAD_PREAMBLE = "Figures:\n<facts>\n";
export const PAYLOAD_CLOSE = "\n</facts>";
