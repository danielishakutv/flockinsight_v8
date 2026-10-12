import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SendPacer,
  isRetryableNetworkError,
  isRetryableResendError,
  isRetryableStatus,
  parseRetryAfter,
  withRetry,
  type AttemptResult,
} from "@/lib/email-pacing";

describe("SendPacer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("never starts more than perSecond sends in any one second", async () => {
    const pacer = new SendPacer({ maxInFlight: 50, perSecond: 8 });
    const startedAt: number[] = [];
    const all = Array.from({ length: 30 }, () =>
      pacer.run("bulk", async () => {
        startedAt.push(Date.now());
      }),
    );
    await vi.runAllTimersAsync();
    await Promise.all(all);

    expect(startedAt).toHaveLength(30);
    // Every sliding one-second window holds at most 8 starts.
    for (const t of startedAt) {
      const inWindow = startedAt.filter((s) => s >= t && s < t + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(8);
    }
    // ...and 30 at 8/s takes at least three further seconds.
    expect(Math.max(...startedAt)).toBeGreaterThanOrEqual(3000);
  });

  it("caps how many are in flight at once", async () => {
    const pacer = new SendPacer({ maxInFlight: 3, perSecond: 100 });
    let running = 0;
    let peak = 0;
    const all = Array.from({ length: 12 }, () =>
      pacer.run("bulk", async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 50));
        running--;
      }),
    );
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(peak).toBe(3);
  });

  it("lets a single transactional email overtake a queued broadcast", async () => {
    const pacer = new SendPacer({ maxInFlight: 1, perSecond: 100 });
    const order: string[] = [];
    const bulk = Array.from({ length: 5 }, (_, i) =>
      pacer.run("bulk", async () => {
        order.push(`bulk${i}`);
        await new Promise((r) => setTimeout(r, 10));
      }),
    );
    const reset = pacer.run("now", async () => {
      order.push("password-reset");
    });
    await vi.runAllTimersAsync();
    await Promise.all([...bulk, reset]);
    // bulk0 was already running; the reset goes next, not sixth.
    expect(order.indexOf("password-reset")).toBe(1);
  });

  it("passes a rejection through and keeps going", async () => {
    const pacer = new SendPacer({ maxInFlight: 1, perSecond: 100 });
    const a = pacer.run("now", async () => {
      throw new Error("boom");
    });
    const b = pacer.run("now", async () => "fine");
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("fine");
  });
});

describe("withRetry", () => {
  const sleep = vi.fn(async () => {});

  beforeEach(() => sleep.mockClear());

  it("retries a retryable failure and returns the eventual success", async () => {
    const results: AttemptResult<string>[] = [
      { ok: false, error: "429", retryable: true },
      { ok: false, error: "503", retryable: true },
      { ok: true, value: "id-1" },
    ];
    const res = await withRetry(async () => results.shift()!, { sleep, random: () => 0 });
    expect(res).toMatchObject({ ok: true, value: "id-1", attempts: 3 });
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([500, 1000]);
  });

  it("does not retry a failure that cannot change", async () => {
    const attempt = vi.fn(async (): Promise<AttemptResult<string>> => ({
      ok: false,
      error: "422 invalid to",
      retryable: false,
    }));
    const res = await withRetry(attempt, { sleep });
    expect(res).toMatchObject({ ok: false, attempts: 1 });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the last attempt and reports the last error", async () => {
    const res = await withRetry(
      async (): Promise<AttemptResult<string>> => ({ ok: false, error: "still 429", retryable: true }),
      { sleep, attempts: 3 },
    );
    expect(res).toMatchObject({ ok: false, error: "still 429", attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After, capped", async () => {
    const results: AttemptResult<string>[] = [
      { ok: false, error: "429", retryable: true, retryAfterMs: 2000 },
      { ok: false, error: "429", retryable: true, retryAfterMs: 3_600_000 },
      { ok: true, value: "x" },
    ];
    await withRetry(async () => results.shift()!, { sleep, maxWaitMs: 10_000 });
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([2000, 10_000]);
  });
});

describe("failure classification", () => {
  it("retries 429 and 5xx, not other 4xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(422)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(null)).toBe(false);
  });

  it("classifies Resend's named errors", () => {
    expect(isRetryableResendError({ name: "rate_limit_exceeded", statusCode: 429 })).toBe(true);
    expect(isRetryableResendError({ name: "application_error", statusCode: null })).toBe(true);
    expect(isRetryableResendError({ name: "validation_error", statusCode: 422 })).toBe(false);
    expect(isRetryableResendError({ name: "daily_quota_exceeded", statusCode: 429 })).toBe(false);
    expect(isRetryableResendError({ name: "invalid_api_key", statusCode: 403 })).toBe(false);
  });

  it("retries a connection that never opened, never a timeout", () => {
    expect(isRetryableNetworkError({ cause: { code: "ECONNREFUSED" } })).toBe(true);
    expect(isRetryableNetworkError({ code: "ENOTFOUND" })).toBe(true);
    expect(isRetryableNetworkError({ name: "TimeoutError" })).toBe(false);
    expect(isRetryableNetworkError(new Error("whatever"))).toBe(false);
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0.5")).toBe(500);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
