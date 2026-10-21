import { describe, expect, it } from "vitest";
import { FRAMING_TOKENS, UNKNOWN_RATES, priceUsage, reservationFor } from "./pricing";

describe("priceUsage", () => {
  it("prices Haiku 5.5 at 100 in / 500 out nano-dollars per token", () => {
    expect(priceUsage("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 200 })).toBe(
      1000 * 100 + 200 * 500,
    );
  });

  it("prices Sonnet 5.5 at 2000 in / 10000 out, with cache write and read", () => {
    expect(
      priceUsage("claude-sonnet-5-5", {
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 10,
      }),
    ).toBe(10 * 2000 + 10 * 10000 + 10 * 2500 + 10 * 200);
  });

  it("switches Haiku to the long tier above 100K input-side tokens", () => {
    expect(priceUsage("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 1 })).toBe(
      100_000 * 100 + 500,
    );
    expect(priceUsage("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 1 })).toBe(
      100_001 * 500 + 2500,
    );
  });

  it("prices an unknown model at the top-tier UNKNOWN rates", () => {
    expect(priceUsage("claude-something-new", { input_tokens: 3, output_tokens: 2 })).toBe(
      3 * UNKNOWN_RATES.in + 2 * UNKNOWN_RATES.out,
    );
  });

  it("prices each iteration at its own model's rates, unnamed ones as UNKNOWN", () => {
    const cost = priceUsage("claude-sonnet-5-5", {
      input_tokens: 999,
      output_tokens: 999,
      iterations: [
        { type: "message", model: "claude-sonnet-5-5", input_tokens: 10, output_tokens: 5 },
        { type: "fallback_message", model: "claude-haiku-5-5", input_tokens: 10, output_tokens: 5 },
        { type: "compaction", input_tokens: 1, output_tokens: 1 },
      ],
    });
    expect(cost).toBe(10 * 2000 + 5 * 10000 + (10 * 100 + 5 * 500) + (UNKNOWN_RATES.in + UNKNOWN_RATES.out));
  });

  it("counts null cache fields as 0", () => {
    expect(
      priceUsage("claude-haiku-5-5", {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        iterations: null,
      }),
    ).toBe(600);
  });
});

describe("reservationFor", () => {
  it("matches the analytics worst case in the design: about $0.0038", () => {
    expect(reservationFor("claude-haiku-5-5", 16_384, 4000)).toBe((16_384 + 2000) * 100 + 4000 * 500);
  });

  it("adds the UNKNOWN worst case when a fallback may re-run the request", () => {
    const base = reservationFor("claude-sonnet-5-5", 1000, 100);
    const withFb = reservationFor("claude-sonnet-5-5", 1000, 100, { withFallback: true });
    expect(withFb - base).toBe((1000 + FRAMING_TOKENS) * UNKNOWN_RATES.in + 100 * UNKNOWN_RATES.out);
  });

  it("is never less than the measured cost of any usage within its limits", () => {
    let seed = 7;
    const rnd = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % (max + 1);
    };
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "mystery-model"]) {
      for (let i = 0; i < 500; i++) {
        const bytes = rnd(120_000);
        const maxTokens = 1 + rnd(8000);
        const usage = { input_tokens: rnd(bytes + FRAMING_TOKENS), output_tokens: rnd(maxTokens) };
        expect(reservationFor(model, bytes, maxTokens)).toBeGreaterThanOrEqual(priceUsage(model, usage));
      }
    }
  });
});
