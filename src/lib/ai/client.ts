import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiConfigured, isWorkspaceScopeError } from "./config";
import type { ModelResponse, WireBody } from "./run-ai-rules";

/*
 * The ONLY file in the repository that imports @anthropic-ai/sdk, and only
 * lib/ai/run-ai.ts imports this one (sdk-boundary.test.ts enforces both). So
 * every request to a model passes through runAi's checks and its ledger.
 */

let client: Anthropic | null = null;

/**
 * Lazy, so a server without a key can import this module without crashing.
 * maxRetries 0: with a retry, one ai_call row could stand for two billed
 * requests, and the payload log would stop being exactly what was sent.
 *
 * ANTHROPIC_WORKSPACE_ID, when set, goes on every request as the
 * `anthropic-workspace-id` header. A key created at the organisation level
 * rather than inside a workspace is refused with a 400 without it — and the
 * SDK reads that variable only for federated sign-in, never for an API key,
 * so it has to be added here. Unset, nothing changes.
 */
function getClient(): Anthropic {
  if (!aiConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not set on this server, so no AI request can be made.");
  }
  if (!client) {
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 0,
      ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
    });
  }
  return client;
}

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Wire = { body: WireBody; betas?: string[]; timeoutMs: number };

/**
 * Send exactly `wire.body`. Returns the raw message; interpretation happens
 * in run-ai-rules.ts. Beta (server-side fallback) is Sonnet-only: Haiku has
 * no fallback, so its calls go through the plain endpoint.
 */
export async function callModel(wire: Wire): Promise<ModelResponse> {
  const c = getClient();
  if (wire.betas && wire.betas.length > 0) {
    const msg = await c.beta.messages.create(
      {
        ...(wire.body as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
        betas: wire.betas as Anthropic.Beta.AnthropicBeta[],
      },
      { timeout: wire.timeoutMs },
    );
    return msg as unknown as ModelResponse;
  }
  const msg = await c.messages.create(
    wire.body as unknown as Anthropic.MessageCreateParamsNonStreaming,
    { timeout: wire.timeoutMs },
  );
  return msg as unknown as ModelResponse;
}

export type ModelErrorKind =
  | "auth"
  | "rate_limit"
  | "workspace"
  | "bad_request"
  | "timeout"
  | "api"
  | "connection"
  | "unknown";

/**
 * Classify a thrown error, most specific first, so runAi can decide what it
 * costs and what to tell the operator without importing the SDK itself.
 * APIConnectionTimeoutError is checked before APIConnectionError, which it
 * extends.
 */
export function classifyModelError(e: unknown): { kind: ModelErrorKind; status: number | null; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.AuthenticationError) return { kind: "auth", status: 401, message };
  if (e instanceof Anthropic.RateLimitError) return { kind: "rate_limit", status: 429, message };
  // The one 400 that is about the server's configuration, not the request:
  // the SDK has no class for it, so it is told apart by its wording.
  if (e instanceof Anthropic.BadRequestError && isWorkspaceScopeError(message)) {
    return { kind: "workspace", status: 400, message };
  }
  if (e instanceof Anthropic.BadRequestError) return { kind: "bad_request", status: 400, message };
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout", status: null, message };
  if (e instanceof Anthropic.APIConnectionError) return { kind: "connection", status: null, message };
  if (e instanceof Anthropic.APIError) {
    return { kind: "api", status: typeof e.status === "number" ? e.status : null, message };
  }
  return { kind: "unknown", status: null, message };
}
