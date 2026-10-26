/**
 * How the AI and assistant platform settings are read, without the database:
 * every value in platform_setting is a string an admin (or a bad deploy) can
 * get wrong, so each one is parsed here, fail closed, and unit-tested. The
 * getters and setters that touch platform_setting live in settings.ts.
 *
 * Pure: no server-only, no database.
 */

import {
  ASSISTANT_PERSON_DAILY,
  ASSISTANT_QUESTIONS_BY_PLAN,
  PLAN_ORDER,
  planRank,
} from "@/lib/entitlements";
import type { PlanId } from "@/lib/plans";

/**
 * The hard stop for one church's monthly AI money. It cannot be raised from
 * the UI: raising it is a code change, which is the owner's decision, not a
 * setting an operator can drift past. (Re-exported from settings.ts, where it
 * has always been imported from.)
 */
export const AI_CHURCH_SHARE_MAX_USD = 5;

/**
 * Each church's monthly AI money by plan, in USD: the backstop under the
 * question allowances. A Starter church asks how-to questions; a Pro church
 * asks the advisor hundreds of times a month, so one flat share either
 * starved the larger plans or over-trusted the smallest.
 */
export const AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD: Readonly<Record<PlanId, number>> = Object.freeze({
  starter: 0.25,
  growth: 1,
  pro: 2.5,
  enterprise: 5,
});

/** Admin-editable numbers are whole and bounded, so a typo cannot mean "a million". */
export const ALLOWANCE_MAX = 100_000;

export type AssistantAllowances = {
  starter: number | null;
  growth: number | null;
  pro: number | null;
  enterprise: number | null;
  /** Every church's per-person daily allowance. Never null: a person always has a day's limit. */
  perPersonDaily: number;
};

export const ASSISTANT_ALLOWANCE_DEFAULTS: Readonly<AssistantAllowances> = Object.freeze({
  ...ASSISTANT_QUESTIONS_BY_PLAN,
  perPersonDaily: ASSISTANT_PERSON_DAILY,
});

export type AdvisorRollout = "off" | "pilot" | "all";
export const ADVISOR_ROLLOUTS: readonly AdvisorRollout[] = ["off", "pilot", "all"];

/** The rollout when nothing has been saved: only the pilot churches. */
export const ADVISOR_ROLLOUT_DEFAULT: AdvisorRollout = "pilot";

/**
 * The pilot list when nothing has been saved: the owner's own church, on Pro
 * and already opted in, so the advisor meets a real church before anyone
 * else's.
 */
export const ADVISOR_PILOT_DEFAULT: readonly string[] = Object.freeze(["flockinsight-church"]);

/** A church slug as the church table stores it. Anything else in the list is refused. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Outcome of a parse: the value to use, and whether the stored text was readable. */
export type Parsed<T> = { value: T; ok: boolean };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clampShare(n: number): number {
  return Math.min(AI_CHURCH_SHARE_MAX_USD, Math.max(0, Math.round(n * 100) / 100));
}

/**
 * `ai_church_share_by_plan`: `{ starter, growth, pro, enterprise }` in USD.
 *
 * Every plan must be there as a finite number, each clamped to
 * 0..AI_CHURCH_SHARE_MAX_USD. Anything unreadable falls back to the code
 * defaults as a whole rather than mixing a half-read setting with defaults,
 * because a half-read money setting is one nobody can reason about.
 */
export function parseChurchShareByPlan(raw: string): Parsed<Record<PlanId, number>> {
  const fallback = { value: { ...AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD }, ok: false };
  if (!raw.trim()) return fallback;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isPlainObject(v)) return fallback;
  const out = {} as Record<PlanId, number>;
  for (const plan of PLAN_ORDER) {
    const n = v[plan];
    if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
    out[plan] = clampShare(n);
  }
  return { value: out, ok: true };
}

/** The share a church gets by its plan. An unknown plan gets the smallest plan's share. */
export function churchShareUsdFor(
  plan: string | null | undefined,
  byPlan: Readonly<Record<PlanId, number>>,
): number {
  const id = PLAN_ORDER[planRank(plan)];
  return clampShare(byPlan[id] ?? byPlan.starter ?? AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD.starter);
}

/** Clean an admin's input for saving: every plan present, clamped, rounded to cents. */
export function normaliseChurchShareByPlan(input: Partial<Record<PlanId, number>>): Record<PlanId, number> {
  const out = {} as Record<PlanId, number>;
  for (const plan of PLAN_ORDER) {
    const n = input[plan];
    out[plan] = typeof n === "number" && Number.isFinite(n) ? clampShare(n) : AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD[plan];
  }
  return out;
}

function isAllowance(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= ALLOWANCE_MAX;
}

/**
 * `assistant_allowances`: `{ starter, growth, pro, enterprise, perPersonDaily }`.
 *
 * Plans may be null (no ceiling); perPersonDaily may not. Every number is a
 * whole 0..ALLOWANCE_MAX. Anything unreadable, a missing key included, falls
 * back to the code defaults as a whole: an allowance setting nobody can read
 * must land on the numbers the price list advertises, never on "unlimited".
 */
export function parseAssistantAllowances(raw: string): Parsed<AssistantAllowances> {
  const fallback = { value: { ...ASSISTANT_ALLOWANCE_DEFAULTS }, ok: false };
  if (!raw.trim()) return fallback;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isPlainObject(v)) return fallback;
  const out = { ...ASSISTANT_ALLOWANCE_DEFAULTS };
  for (const plan of PLAN_ORDER) {
    if (!(plan in v)) return fallback;
    const n = v[plan];
    if (n === null) out[plan] = null;
    else if (isAllowance(n)) out[plan] = n;
    else return fallback;
  }
  if (!isAllowance(v.perPersonDaily)) return fallback;
  out.perPersonDaily = v.perPersonDaily;
  return { value: out, ok: true };
}

/** The same rules for an admin's input before it is saved. Null when it would not parse back. */
export function validateAssistantAllowances(input: unknown): AssistantAllowances | null {
  const parsed = parseAssistantAllowances(JSON.stringify(input ?? null));
  return parsed.ok ? parsed.value : null;
}

/**
 * `assistant_advisor_rollout`. Only the three exact words count; anything
 * else switches the church advisor off (fail closed), and the caller logs it.
 * An absent setting never reaches here: the getter's fallback is the default.
 */
export function parseAdvisorRollout(raw: string): Parsed<AdvisorRollout> {
  const v = raw.trim();
  return (ADVISOR_ROLLOUTS as readonly string[]).includes(v)
    ? { value: v as AdvisorRollout, ok: true }
    : { value: "off", ok: false };
}

/**
 * `assistant_advisor_pilot`: a JSON array of church slugs. Unreadable, or
 * holding anything that is not a slug, means NO pilot churches: the safe
 * reading of a list nobody can read is the empty one.
 */
export function parseAdvisorPilot(raw: string): Parsed<string[]> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { value: [], ok: false };
  }
  if (!Array.isArray(v)) return { value: [], ok: false };
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== "string" || !SLUG.test(s)) return { value: [], ok: false };
    if (!out.includes(s)) out.push(s);
  }
  return { value: out, ok: true };
}

/** Clean a pilot list for saving: slugs only, de-duplicated, at most 200. Null when one is not a slug. */
export function normaliseAdvisorPilot(slugs: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const raw of slugs) {
    const s = raw.trim().toLowerCase();
    if (!SLUG.test(s)) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 200);
}
