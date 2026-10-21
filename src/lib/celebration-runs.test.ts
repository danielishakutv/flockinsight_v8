import { describe, expect, it } from "vitest";
import {
  CELEBRATION_MAX_ATTEMPTS,
  PENDING_STALE_MS,
  RETRY_AFTER_MS,
  churchCanClearSmsRefusal,
  claimDecision,
  gatewayRefusedEveryNumber,
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

  /*
   * The first-timer sequence uses the same rule with its own budget. It used
   * to reclaim any row that was not sent or queued, so the 07:00 sweep from
   * the reminders job took the hourly sweep's fresh "pending" rows and sent
   * the same welcome again.
   */
  describe("with another job's attempt budget", () => {
    it("leaves another sweep's fresh pending claim alone", () => {
      expect(
        claimDecision({ outcome: "pending", attempts: 1, updatedAt: ago(MIN) }, NOW, "email", 3),
      ).toBe("leave");
      expect(
        claimDecision({ outcome: "pending", attempts: 1, updatedAt: ago(MIN) }, NOW, "sms", 3),
      ).toBe("leave");
    });

    it("never texts a dead SMS claim again", () => {
      const dead = { outcome: "pending", attempts: 2, updatedAt: ago(2 * PENDING_STALE_MS) };
      expect(claimDecision(dead, NOW, "sms", 3)).toBe("abandon");
    });

    it("stops at the budget it is given, not the celebrations one", () => {
      const failed = { outcome: "failed", attempts: 2, updatedAt: ago(2 * RETRY_AFTER_MS) };
      expect(claimDecision(failed, NOW, "email", 3)).toBe("reclaim");
      expect(claimDecision(failed, NOW, "email", 2)).toBe("leave");
    });
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

  it("keeps the gateway's message id, so the history row can be matched by the delivery report", () => {
    const { settled } = matchSmsOutcomes(
      [{ id: "a", phone: "0801" }],
      [{ phone: "0801", status: "sent", providerMessageId: "3017607" }],
    );
    expect(settled[0].providerMessageId).toBe("3017607");
  });

  it("keeps a number that was never tried apart from one that failed", () => {
    const { settled } = matchSmsOutcomes(
      [
        { id: "a", phone: "abc" },
        { id: "b", phone: "0802" },
      ],
      [
        { phone: "abc", status: "skipped", error: "Not a usable phone number" },
        { phone: "0802", status: "failed", error: "Rejected" },
      ],
    );
    expect(settled.map((s) => [s.job.id, s.ok, s.status])).toEqual([
      ["a", false, "skipped"],
      ["b", false, "failed"],
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

  it("names the feature it is advising about", () => {
    expect(smsRefusalAdvice("Insufficient balance")).toMatch(/for celebrations\.$/);
    expect(smsRefusalAdvice("Insufficient balance", "service reminders")).toMatch(
      /for service reminders\.$/,
    );
  });
});

/*
 * A service reminder batch the gateway refused outright came back `ok: true`
 * with nothing sent, and nothing logged it or told anybody.
 */
describe("gatewayRefusedEveryNumber", () => {
  it("is a batch where nothing went and something was refused", () => {
    expect(gatewayRefusedEveryNumber({ sent: 0, failed: 40, unconfirmed: 0 })).toBe(true);
  });

  it("is not a batch where anything went", () => {
    expect(gatewayRefusedEveryNumber({ sent: 1, failed: 39, unconfirmed: 0 })).toBe(false);
  });

  it("is not a batch where some may have gone", () => {
    // Unconfirmed is charged and may have arrived; calling it refused would
    // invite a second send.
    expect(gatewayRefusedEveryNumber({ sent: 0, failed: 39, unconfirmed: 1 })).toBe(false);
  });

  it("is not an empty batch", () => {
    expect(gatewayRefusedEveryNumber({ sent: 0, failed: 0, unconfirmed: 0 })).toBe(false);
  });
});

describe("churchCanClearSmsRefusal", () => {
  it("recognises the church's own wallet and sender ID refusals", () => {
    // Worded as church-sms.ts words them.
    expect(
      churchCanClearSmsRefusal(
        "Not enough SMS balance. This needs 12.00 but your balance is 3.00.",
      ),
    ).toBe(true);
    expect(
      churchCanClearSmsRefusal("Your SMS sender ID isn't approved yet. Apply in Settings → SMS."),
    ).toBe(true);
  });

  it("does not blame the church for the gateway, or for one bad number", () => {
    // The platform's float, not the church's wallet.
    expect(churchCanClearSmsRefusal("Insufficient balance")).toBe(false);
    expect(churchCanClearSmsRefusal("No valid phone number to send to.")).toBe(false);
    expect(churchCanClearSmsRefusal("SMS isn't enabled on the platform yet.")).toBe(false);
  });
});
