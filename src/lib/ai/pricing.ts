/**
 * What a call costs, in nano-dollars (1e-9 USD) per token, as integers.
 *
 * Haiku 5.5 input is $0.10 per million tokens = 100 nano-dollars per token,
 * which micro-dollars could not express without fractions. Cache prices are
 * taken as 1.25x (write) and 0.1x (read) of input; these payloads sit far
 * below the minimum cacheable prefix, so cache tokens are 0 in practice.
 * Confirm the figures against Anthropic's pricing page when a model changes.
 *
 * Pure.
 */

export type Rates = { in: number; out: number; cacheWrite: number; cacheRead: number };

type ModelPrice = { base: Rates; long?: { aboveTokens: number; rates: Rates } };

export const PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "claude-haiku-5-5": {
    base: { in: 100, out: 500, cacheWrite: 125, cacheRead: 10 },
    // Above 100K input tokens the whole request is billed at the long rates.
    long: { aboveTokens: 100_000, rates: { in: 500, out: 2500, cacheWrite: 625, cacheRead: 50 } },
  },
  "claude-sonnet-5-5": {
    base: { in: 2000, out: 10000, cacheWrite: 2500, cacheRead: 200 },
  },
});

/**
 * Any model not in the table, such as one a server-side fallback picked. These
 * are the top tier's rates, so an unknown model is over-counted, never under.
 */
export const UNKNOWN_RATES: Rates = Object.freeze({
  in: 10000,
  out: 50000,
  cacheWrite: 12500,
  cacheRead: 1000,
});

/** The usage fields priced. Nullable everywhere, because the SDK types are. */
export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Beta responses only: one entry per model that ran (a fallback adds one). */
  iterations?: ReadonlyArray<{
    type?: string;
    model?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }> | null;
};

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function ratesFor(model: string | null | undefined, inputSideTokens: number): Rates {
  const p = model ? PRICES[model] : undefined;
  if (!p) return UNKNOWN_RATES;
  if (p.long && inputSideTokens > p.long.aboveTokens) return p.long.rates;
  return p.base;
}

function priceOne(
  model: string | null | undefined,
  u: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): number {
  const input = n(u.input_tokens);
  const output = n(u.output_tokens);
  const cw = n(u.cache_creation_input_tokens);
  const cr = n(u.cache_read_input_tokens);
  const r = ratesFor(model, input + cw + cr);
  return input * r.in + output * r.out + cw * r.cacheWrite + cr * r.cacheRead;
}

/**
 * The measured cost of a response. When usage.iterations is present (a beta
 * call, where a fallback may have run), each entry is priced at its own
 * model's rates (UNKNOWN when it is unnamed) and summed.
 */
export function priceUsage(model: string, usage: UsageLike): number {
  if (usage.iterations && usage.iterations.length > 0) {
    let total = 0;
    for (const it of usage.iterations) total += priceOne(it.model ?? null, it);
    return Math.ceil(total);
  }
  return Math.ceil(priceOne(model, usage));
}

/** Fixed allowance for message framing on top of the request bytes. */
export const FRAMING_TOKENS = 2000;

/**
 * The worst case a request can cost, held against the budget before sending.
 * A token is at least one byte of text, so bytes + framing bounds the input.
 * A fallback re-runs the request on another model, so with fallbacks the
 * unknown model's worst case is added on top.
 */
export function reservationFor(
  model: string,
  requestBytes: number,
  maxTokens: number,
  opts: { withFallback?: boolean } = {},
): number {
  const inputTokens = Math.max(0, Math.ceil(requestBytes)) + FRAMING_TOKENS;
  const out = Math.max(0, Math.ceil(maxTokens));
  const r = ratesFor(model, inputTokens);
  let total = inputTokens * r.in + out * r.out;
  if (opts.withFallback) total += inputTokens * UNKNOWN_RATES.in + out * UNKNOWN_RATES.out;
  return Math.ceil(total);
}

/** Display helper: nano-dollars to a "$0.0038" string. */
export function formatNanoUsd(nano: number, digits = 4): string {
  return `$${(nano / 1e9).toFixed(digits)}`;
}
