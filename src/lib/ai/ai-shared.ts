/**
 * The AI types and rules a client component can import. Pure and client-safe:
 * no server-only, no database, no SDK.
 */

import type { PermissionKey } from "@/lib/permissions-catalog";
import type { TKey } from "@/lib/i18n/translate";

/** Why runAi did not produce text. One cause per value, never one for five. */
export type AiReason =
  | "invalid_input"
  | "not_configured"
  | "killed"
  | "feature_paused"
  | "not_opted_in"
  | "payload_rejected"
  | "platform_budget"
  | "church_budget"
  | "refused"
  | "truncated"
  | "provider_error";

export const AI_REASONS: readonly AiReason[] = [
  "invalid_input",
  "not_configured",
  "killed",
  "feature_paused",
  "not_opted_in",
  "payload_rejected",
  "platform_budget",
  "church_budget",
  "refused",
  "truncated",
  "provider_error",
];

/** Reasons the summary feature and its actions add on top of runAi's. */
export type SummaryUiReason =
  | "thin_data"
  | "in_progress"
  | "tried_today"
  | "too_fast"
  | "role_too_narrow";

export const SUMMARY_UI_REASONS: readonly SummaryUiReason[] = [
  "thin_data",
  "in_progress",
  "tried_today",
  "too_fast",
  "role_too_narrow",
];

export type UiReason = AiReason | SummaryUiReason;

/**
 * What a church user reads for each cause, translated. runAi's English
 * message is kept for the logs and the superadmin, where the operator needs
 * the technical cause rather than the polite one.
 */
export const REASON_KEY: Readonly<Record<UiReason, TKey>> = Object.freeze({
  invalid_input: "ai.failed",
  not_configured: "ai.notConfigured",
  killed: "ai.paused",
  feature_paused: "ai.paused",
  not_opted_in: "ai.turnOnStaff",
  payload_rejected: "ai.failed",
  platform_budget: "ai.budget",
  church_budget: "ai.budget",
  refused: "ai.refused",
  truncated: "ai.truncated",
  provider_error: "ai.failed",
  thin_data: "ai.thinData",
  in_progress: "ai.inProgress",
  tried_today: "ai.triedToday",
  too_fast: "ai.tooFast",
  role_too_narrow: "ai.roleTooNarrow",
});

export function isUiReason(v: unknown): v is UiReason {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REASON_KEY, v);
}

/**
 * The summary describes giving trends and follow-up stages, which the
 * Analytics page itself does not show; those sit behind their own
 * permissions. So reading or generating one needs all three, or ownership.
 */
export const SUMMARY_PERMS = ["analytics.view", "giving.view", "followup.view"] as const;

export function canReadChurchSummary(access: {
  isOwner: boolean;
  perms: ReadonlySet<PermissionKey>;
}): boolean {
  return access.isOwner || SUMMARY_PERMS.every((p) => access.perms.has(p));
}

export type SummaryStatus = "pending" | "ready" | "failed" | "skipped";

export type SummaryAvailability = {
  configured: boolean;
  killed: boolean;
  analyticsPaused: boolean;
  optedIn: boolean;
  isDemo: boolean;
  onPlan: boolean;
};

export type SummaryLatest = { text: string; day: string; reused: boolean };
export type SummaryToday = { status: SummaryStatus; reason: string | null; attempts: number };

export type ChurchSummaryView = {
  latest: SummaryLatest | null;
  today: SummaryToday | null;
  availability: SummaryAvailability;
  /** Summaries actually written (status ok) for this church this UTC month. */
  monthCount: number;
};

export type PlatformSummaryView = {
  latest: SummaryLatest | null;
  today: SummaryToday | null;
  availability: Pick<SummaryAvailability, "configured" | "killed" | "analyticsPaused">;
  monthCount: number;
};

/** Is AI usable for this church right now, ignoring whether a summary exists? */
export function summaryAvailable(a: SummaryAvailability): boolean {
  return a.configured && !a.killed && !a.analyticsPaused && a.optedIn && !a.isDemo && a.onPlan;
}
