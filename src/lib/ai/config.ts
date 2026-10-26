import "server-only";
import type { AiFeature } from "@/db/schema";

/**
 * Anthropic refuses an organisation-level key with "This API key is not
 * scoped to a workspace, so this request must include the
 * anthropic-workspace-id header". It is a setup problem with a two-line fix,
 * so it gets its own sentence instead of "the request was malformed".
 */
export function isWorkspaceScopeError(message: string): boolean {
  return /not scoped to a workspace|anthropic-workspace-id/i.test(message);
}

/** What to do about it, for the operator. */
export const WORKSPACE_FIX =
  "The AI key on the server belongs to the organisation, not a workspace, so Anthropic refuses it. Fix: either create a key inside a workspace (Claude Console → Settings → Workspaces → API keys) and put it in ANTHROPIC_API_KEY, or add ANTHROPIC_WORKSPACE_ID=<the workspace id> to the server's .env — then restart with pm2 restart flockinsight --update-env.";

/**
 * Is AI switched on for this server at all?
 *
 * Only whether the key is present. The key itself is never logged, rendered
 * or written anywhere; the superadmin page shows "set" or "not set".
 */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;

export type AiModel = (typeof MODELS)[keyof typeof MODELS];

/** Haiku 5.5's output effort. Sonnet takes none, so a Sonnet policy leaves it unset. */
export type AiEffort = "low" | "medium";

export type FeaturePolicy = {
  /** The one model this feature may use. Stops a feature drifting onto the expensive one. */
  model: AiModel;
  maxTokens: number;
  maxRequestBytes: number;
  timeoutMs: number;
  /** May typed text go out? False for analytics: only the serialiser carries data there. */
  freeText: boolean;
  /** Must a church id be present ("required"), absent ("never"), or either ("optional")? */
  churchScoped: "required" | "never" | "optional";
  /**
   * Sent as output_config.effort on a Haiku call. Haiku 5.5 defaults to
   * medium: a short briefing or a how-to answer needs only low, while an
   * advisor answer that weighs figures and writes recommendations earns
   * medium. Thinking counts against max_tokens, which is why the advisor's
   * ceiling is higher too.
   */
  effort?: AiEffort;
};

/*
 * Every request stays far below Haiku's 100K-token price step.
 *
 * Analytics allows 4000 output tokens, not 1500: on Haiku 5.5 adaptive thinking
 * counts against max_tokens and is billed as output, so a tighter cap risks a
 * truncated summary that was paid for. The worst case is still about $0.0055.
 *
 * Analytics and chat are "optional", not "required". Analytics serves the
 * operator's platform briefing as well as a church's, so the PROMPT decides
 * whether a church id belongs (PROMPT_SCOPE in prompts.ts). The help assistant
 * also answers on the platform's behalf (drafting a canned answer for review)
 * with no church in scope. Whenever a church IS named, its own owner's opt-in
 * governs the call.
 *
 * The advisor is its own feature, not "chat" with a bigger ceiling, so it can
 * be paused on its own and its spend reads separately on /superadmin/ai. Its
 * request carries the figures, the guide extracts and three exchanges of
 * history, hence 48 KB; its answer has four short sections, hence 2500
 * tokens with medium effort. The worst case is still under a cent.
 */
export const FEATURE_POLICY: Readonly<Record<AiFeature, FeaturePolicy>> = Object.freeze({
  analytics: {
    model: MODELS.haiku,
    maxTokens: 4000,
    maxRequestBytes: 16_384,
    timeoutMs: 60_000,
    freeText: false,
    churchScoped: "optional",
    effort: "low",
  },
  chat: {
    model: MODELS.haiku,
    maxTokens: 1000,
    maxRequestBytes: 32_768,
    timeoutMs: 60_000,
    freeText: true,
    churchScoped: "optional",
    effort: "low",
  },
  blog: {
    model: MODELS.sonnet,
    maxTokens: 8000,
    maxRequestBytes: 65_536,
    timeoutMs: 180_000,
    freeText: true,
    churchScoped: "never",
  },
  advisor: {
    model: MODELS.haiku,
    maxTokens: 2500,
    maxRequestBytes: 49_152,
    timeoutMs: 60_000,
    freeText: true,
    churchScoped: "optional",
    effort: "medium",
  },
});
