import { describe, expect, it } from "vitest";
import {
  celebrationKeysFor,
  celebrationWindow,
  displayZone,
  eventsForMember,
  localNow,
  windowLookup,
} from "@/lib/celebration-window";
import {
  CELEBRATION_MAX_ATTEMPTS,
  PENDING_STALE_MS,
  claimDecision,
  matchSmsOutcomes,
  smsRefusalAdvice,
} from "@/lib/celebration-runs";

const person = (over: Partial<Parameters<typeof eventsForMember>[0]> = {}) => ({
  dateOfBirth: null,
  weddingDate: null,
  baptismDate: null,
  anniversaries: null,
  ...over,
});

describe("today is the church's today, not the server's", () => {
  // 22:30 UTC on 11 October: already the 12th in Nairobi, still the 11th in New York.
  const at = new Date("2026-10-11T22:30:00Z");

  it("starts the window on the church's own date", () => {
    expect(celebrationWindow("Africa/Nairobi", 2, at).map((w) => w.key)).toEqual([
      "10-12",
      "10-13",
    ]);
    expect(celebrationWindow("America/New_York", 2, at)[0].key).toBe("10-11");
    expect(localNow("Africa/Lagos", at).date).toBe("2026-10-11");
  });

  it("rolls over the year in the church's calendar", () => {
    const w = celebrationWindow("Africa/Lagos", 3, new Date("2026-12-31T12:00:00Z"));
    expect(w.map((d) => `${d.year}-${d.key}`)).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("falls back for display when the stored zone is broken", () => {
    expect(displayZone("Africa/Maputo")).toBe("Africa/Maputo");
    expect(displayZone("GMT+2")).toBe("Africa/Lagos");
    expect(displayZone(null)).toBe("Africa/Lagos");
  });
});

describe("29 February", () => {
  const leapling = person({ dateOfBirth: "0004-02-29", weddingDate: "2016-02-29" });

  it("is celebrated on 28 February in a year without a 29th", () => {
    const keys = celebrationKeysFor("02-28", 2027);
    expect(keys).toEqual(["02-28", "02-29"]);
    expect(eventsForMember(leapling, keys, 2027).map((e) => e.kind)).toEqual([
      "birthday",
      "wedding",
    ]);
  });

  it("is celebrated on the day itself in a leap year, and not the day before", () => {
    expect(eventsForMember(leapling, celebrationKeysFor("02-28", 2028), 2028)).toEqual([]);
    expect(
      eventsForMember(leapling, celebrationKeysFor("02-29", 2028), 2028).map((e) => e.kind),
    ).toEqual(["birthday", "wedding"]);
  });

  it("appears in the upcoming lists on the 28th of a common year", () => {
    const lookup = windowLookup(
      celebrationWindow("Africa/Lagos", 3, new Date("2027-02-27T12:00:00Z")),
    );
    expect(lookup.get("02-29")?.key).toBe("02-28");
    expect(lookup.get("02-29")?.offset).toBe(1);
  });

  it("counts anniversary years against the year it is celebrated in", () => {
    const [, wedding] = eventsForMember(leapling, celebrationKeysFor("02-28", 2027), 2027);
    expect(wedding.years).toBe(11);
  });
});

describe("eventsForMember", () => {
  it("gives a year-less birthday no age and a custom anniversary its label", () => {
    const ev = eventsForMember(
      person({
        dateOfBirth: "0004-05-01",
        anniversaries: [{ label: "Ordination", date: "2010-05-01" }],
      }),
      ["05-01"],
      2026,
    );
    expect(ev).toEqual([
      { kind: "birthday", occasion: "birthday", years: null },
      { kind: "Ordination", occasion: "Ordination", years: 16 },
    ]);
  });
});

describe("claimDecision: a failed greeting is retried, a sent one never", () => {
  const now = new Date("2026-10-12T09:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("inserts when there is no row yet", () => {
    expect(claimDecision(undefined, now, "sms")).toBe("insert");
    expect(claimDecision(undefined, now, "email")).toBe("insert");
  });

  it("leaves what went, or what the SMS queue now owns", () => {
    for (const ch of ["sms", "email"] as const) {
      expect(claimDecision({ outcome: "sent", attempts: 1, updatedAt: ago(0) }, now, ch)).toBe(
        "leave",
      );
      expect(claimDecision({ outcome: "queued", attempts: 1, updatedAt: ago(0) }, now, ch)).toBe(
        "leave",
      );
    }
  });

  it("retries a failure until the attempts run out", () => {
    for (const ch of ["sms", "email"] as const) {
      expect(claimDecision({ outcome: "failed", attempts: 1, updatedAt: ago(0) }, now, ch)).toBe(
        "reclaim",
      );
      expect(
        claimDecision(
          { outcome: "failed", attempts: CELEBRATION_MAX_ATTEMPTS, updatedAt: ago(0) },
          now,
          ch,
        ),
      ).toBe("leave");
    }
  });

  it("leaves another run's send in flight, on either channel", () => {
    for (const ch of ["sms", "email"] as const) {
      expect(
        claimDecision({ outcome: "pending", attempts: 1, updatedAt: ago(60_000) }, now, ch),
      ).toBe("leave");
    }
  });

  it("re-sends an email a crash abandoned: a second one costs nothing", () => {
    expect(
      claimDecision(
        { outcome: "pending", attempts: 1, updatedAt: ago(PENDING_STALE_MS + 1) },
        now,
        "email",
      ),
    ).toBe("reclaim");
  });

  /*
   * A pending SMS row older than the stale window means the process died after
   * claiming it — possibly after the gateway had sent and charged it. Sending
   * it again would text the member twice and charge the church twice.
   */
  it("never re-sends an SMS a crash abandoned; it is settled instead", () => {
    expect(
      claimDecision(
        { outcome: "pending", attempts: 1, updatedAt: ago(PENDING_STALE_MS + 1) },
        now,
        "sms",
      ),
    ).toBe("abandon");
  });
});

describe("matchSmsOutcomes", () => {
  it("settles a household's two greetings on one number separately, in order", () => {
    const jobs = [
      { runId: "a", phone: "+2348031234567" },
      { runId: "b", phone: "+2348031234567" },
      { runId: "c", phone: "+2348099999999" },
    ];
    const { settled, unreported } = matchSmsOutcomes(jobs, [
      { phone: "+2348031234567", status: "sent" },
      { phone: "+2348031234567", status: "failed", error: "Rejected" },
    ]);
    expect(settled.map((s) => [s.job.runId, s.ok, s.error])).toEqual([
      ["a", true, null],
      ["b", false, "Rejected"],
    ]);
    // Never left "pending": the caller records it as failed.
    expect(unreported.map((j) => j.runId)).toEqual(["c"]);
  });
});

describe("smsRefusalAdvice: the notice points at what is actually wrong", () => {
  it("sends a church to its wallet only when the wallet is the problem", () => {
    expect(
      smsRefusalAdvice("Not enough SMS balance. This needs 12.00 but your balance is 3.00."),
    ).toMatch(/Wallet/);
    for (const other of [
      "Your SMS sender ID isn't approved yet. Apply in Settings → SMS.",
      "No valid phone numbers to send to.",
      "SMS isn't available in your country yet, so nothing was sent or charged.",
      "Something nobody anticipated.",
    ]) {
      expect(smsRefusalAdvice(other), other).not.toMatch(/Wallet/);
    }
  });

  it("names the sender ID and the numbers when those are the cause", () => {
    expect(smsRefusalAdvice("Your SMS sender ID isn't approved yet.")).toMatch(/sender ID/);
    expect(smsRefusalAdvice("No valid phone numbers to send to.")).toMatch(/member records/);
  });
});
