import { describe, expect, it } from "vitest";
import {
  CELEBRATION_MAX_ATTEMPTS,
  PENDING_STALE_MS,
  RETRY_AFTER_MS,
  claimDecision,
  matchSmsOutcomes,
  smsRefusalAdvice,
} from "@/lib/celebration-runs";

const NOW = new Date("2026-10-13T07:00:00Z"); // 08:00 in Lagos
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

describe("claimDecision", () => {
  it("claims a greeting nothing has touched today", () => {
    expect(claimDecision(undefined, NOW, "sms")).toBe("insert");
  });

  it("leaves a greeting that went, or that the queue owns", () => {
    for (const outcome of ["sent", "queued"]) {
      expect(claimDecision({ outcome, attempts: 1, updatedAt: ago(0) }, NOW, "sms")).toBe(
        "leave",
      );
    }
  });

  it("leaves a greeting that has used up its attempts", () => {
    expect(
      claimDecision(
        { outcome: "failed", attempts: CELEBRATION_MAX_ATTEMPTS, updatedAt: ago(2 * 3_600_000) },
        NOW,
        "sms",
      ),
    ).toBe("leave");
  });

  it("leaves a fresh pending claim alone — it is another run's send in flight", () => {
    expect(
      claimDecision({ outcome: "pending", attempts: 1, updatedAt: ago(PENDING_STALE_MS - 1) }, NOW, "sms"),
    ).toBe("leave");
  });

  it("abandons a dead SMS claim and retries a dead email claim", () => {
    const dead = { outcome: "pending", attempts: 1, updatedAt: ago(PENDING_STALE_MS) };
    // The SMS may have gone and been charged before the process died.
    expect(claimDecision(dead, NOW, "sms")).toBe("abandon");
    // A second email costs nothing.
    expect(claimDecision(dead, NOW, "email")).toBe("reclaim");
  });

  /*
   * The sweep now runs every five minutes. Without spacing of its own, a
   * wallet that was empty at 08:00 would have been asked again at 08:05 and
   * 08:10 and then given up for the day — the three attempts the design
   * promises would all have happened before anyone could top it up.
   */
  it("does not retry a failure at the next five-minute sweep", () => {
    const justFailed = { outcome: "failed", attempts: 1, updatedAt: ago(5 * MIN) };
    expect(claimDecision(justFailed, NOW, "sms")).toBe("leave");
    expect(claimDecision(justFailed, NOW, "email")).toBe("leave");
  });

  it("retries a failure once an hour has passed", () => {
    const anHourAgo = { outcome: "failed", attempts: 1, updatedAt: ago(RETRY_AFTER_MS) };
    expect(claimDecision(anHourAgo, NOW, "sms")).toBe("reclaim");
    expect(claimDecision(anHourAgo, NOW, "email")).toBe("reclaim");
  });

  it("an hourly sweep landing a few seconds short still counts as an hour", () => {
    // RETRY_AFTER_MS is deliberately under sixty minutes for this reason.
    expect(
      claimDecision({ outcome: "failed", attempts: 1, updatedAt: ago(60 * MIN - 4_000) }, NOW, "sms"),
    ).toBe("reclaim");
  });

  it("gives three attempts across a two-and-a-half-hour window, no more", () => {
    // Replay the day: fail at 08:00, retry at 09:00, retry at 10:00, then stop.
    let state = { outcome: "failed", attempts: 1, updatedAt: new Date("2026-10-13T07:00:05Z") };
    const attemptsAt: string[] = [];
    for (let m = 5; m <= 150; m += 5) {
      const tick = new Date(new Date("2026-10-13T07:00:00Z").getTime() + m * MIN);
      if (claimDecision(state, tick, "sms") === "reclaim") {
        attemptsAt.push(tick.toISOString().slice(11, 16));
        state = { outcome: "failed", attempts: state.attempts + 1, updatedAt: new Date(tick.getTime() + 5_000) };
      }
    }
    expect(attemptsAt).toEqual(["08:00", "09:00"]);
    expect(state.attempts).toBe(CELEBRATION_MAX_ATTEMPTS);
  });
});

describe("matchSmsOutcomes", () => {
  it("settles each greeting with its own number's verdict, in order", () => {
    const jobs = [
      { id: "a", phone: "0801" },
      { id: "b", phone: "0802" },
    ];
    const { settled, unreported } = matchSmsOutcomes(jobs, [
      { phone: "0801", status: "sent" },
      { phone: "0802", status: "failed", error: "Invalid number" },
    ]);
    expect(settled.map((s) => [s.job.id, s.ok, s.error])).toEqual([
      ["a", true, null],
      ["b", false, "Invalid number"],
    ]);
    expect(unreported).toEqual([]);
  });

  it("gives a household's two greetings their own verdicts rather than the first one twice", () => {
    const jobs = [
      { id: "child1", phone: "0801" },
      { id: "child2", phone: "0801" },
    ];
    const { settled } = matchSmsOutcomes(jobs, [
      { phone: "0801", status: "sent" },
      { phone: "0801", status: "failed", error: "Dropped" },
    ]);
    expect(settled.map((s) => [s.job.id, s.ok])).toEqual([
      ["child1", true],
      ["child2", false],
    ]);
  });

  it("returns what the gateway never reported on", () => {
    const jobs = [
      { id: "a", phone: "0801" },
      { id: "b", phone: "0802" },
    ];
    const { settled, unreported } = matchSmsOutcomes(jobs, [{ phone: "0801", status: "sent" }]);
    expect(settled).toHaveLength(1);
    expect(unreported.map((j) => j.id)).toEqual(["b"]);
  });
});

describe("smsRefusalAdvice", () => {
  it("sends the church where the reason points", () => {
    expect(smsRefusalAdvice("Insufficient balance")).toMatch(/Wallet/);
    expect(smsRefusalAdvice("Sender ID not approved")).toMatch(/sender ID/);
    expect(smsRefusalAdvice("No valid phone numbers")).toMatch(/phone number/);
    expect(smsRefusalAdvice("SMS is not available in your country")).toMatch(/Turn SMS off/);
  });
});
