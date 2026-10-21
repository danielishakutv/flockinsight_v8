import "server-only";
import type { AiFeature } from "@/db/schema";

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
 */
export const FEATURE_POLICY: Readonly<Record<AiFeature, FeaturePolicy>> = Object.freeze({
  analytics: {
    model: MODELS.haiku,
    maxTokens: 4000,
    maxRequestBytes: 16_384,
    timeoutMs: 60_000,
    freeText: false,
    churchScoped: "optional",
  },
  chat: {
    model: MODELS.haiku,
    maxTokens: 1000,
    maxRequestBytes: 32_768,
    timeoutMs: 60_000,
    freeText: true,
    churchScoped: "optional",
  },
  blog: {
    model: MODELS.sonnet,
    maxTokens: 8000,
    maxRequestBytes: 65_536,
    timeoutMs: 180_000,
    freeText: true,
    churchScoped: "never",
  },
});
