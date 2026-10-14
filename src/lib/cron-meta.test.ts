import { describe, expect, it } from "vitest";
import { compactMeta, describeMeta, words } from "@/lib/cron-meta";

/*
 * Every cron route answers with a JSON summary and the heartbeat row threw it
 * away, so the health page could say "took 0.0s" and nothing else. These
 * cover the shaping of that summary onto the row and back into a sentence.
 */
describe("compactMeta", () => {
  it("keeps the scalars of a route's answer and drops its ok flag", () => {
    expect(
      compactMeta({ ok: true, churchesChecked: 2, emails: 0, sms: 0, queued: 0, failed: 0 }),
    ).toEqual({ churchesChecked: 2, emails: 0, sms: 0, queued: 0, failed: 0 });
  });

  it("has nothing to say about a body that is not an object", () => {
    expect(compactMeta("ok")).toBeNull();
    expect(compactMeta(null)).toBeNull();
    expect(compactMeta([1, 2])).toBeNull();
    expect(compactMeta({ ok: true })).toBeNull();
  });

  it("keeps one level of nesting, the way the reminders job reports", () => {
    const body = {
      ok: true,
      sent: 1,
      firstTimers: { welcome: 0, invites: 2, deep: { tooFar: 1 } },
      activation: null,
    };
    expect(compactMeta(body)).toEqual({
      sent: 1,
      firstTimers: { welcome: 0, invites: 2 },
      activation: null,
    });
  });

  it("replaces a long list with its length and keeps a short list of scalars", () => {
    const body = {
      wouldSend: Array.from({ length: 300 }, (_, i) => ({ church: `c${i}` })),
      approved: ["RPM YOLA", "FWC"],
    };
    expect(compactMeta(body)).toEqual({
      wouldSend: { count: 300 },
      approved: ["RPM YOLA", "FWC"],
    });
  });

  it("truncates a long string rather than carrying a stack trace", () => {
    const out = compactMeta({ error: "x".repeat(500) });
    expect(out).not.toBeNull();
    const kept = out!.error as string;
    expect(kept.length).toBeLessThanOrEqual(120);
    expect(kept.endsWith("…")).toBe(true);
  });

  it("falls back to scalars alone when even the compacted form is too big", () => {
    const big: Record<string, unknown> = { sent: 3 };
    for (let i = 0; i < 20; i++) {
      big[`group${i}`] = Object.fromEntries(
        Array.from({ length: 20 }, (_, j) => [`key${j}`, "v".repeat(100)]),
      );
    }
    const out = compactMeta(big);
    expect(out).toEqual({ sent: 3 });
  });

  it("drops what a row cannot hold", () => {
    expect(compactMeta({ fn: () => 1, sym: Symbol("s"), n: 1 })).toEqual({ n: 1 });
  });

  /*
   * The health page prints this to platform admins. A route that one day
   * answers "who was emailed" must not turn that page into a list of
   * addresses, and a secret must never reach a heartbeat row.
   */
  it("never stores a value under a personal or secret key, but keeps its count", () => {
    const out = compactMeta({
      sent: 2,
      emails: 2, // a count, kept
      email: "pastor@example.org",
      phone: "08012345678",
      recipients: ["08012345678", "08087654321"],
      members: [{ name: "A" }, { name: "B" }, { name: "C" }],
      userIds: ["u1"],
      apiToken: "sk-live-123",
      nested: { ownerEmail: "x@y.z", notified: 1 },
    });
    expect(out).toEqual({
      sent: 2,
      emails: 2,
      recipients: { count: 2 },
      members: { count: 3 },
      userIds: { count: 1 },
      nested: { notified: 1 },
    });
  });
});

describe("describeMeta", () => {
  it("reads as a sentence, numbers first", () => {
    expect(
      describeMeta({ churchesChecked: 2, emails: 0, sms: 0, queued: 0, failed: 0 }),
    ).toBe("2 churches checked · 0 emails · 0 sms · 0 queued · 0 failed");
  });

  it("says nothing for nothing", () => {
    expect(describeMeta(null)).toBe("");
    expect(describeMeta(undefined)).toBe("");
    expect(describeMeta({})).toBe("");
  });

  it("names a nested value by its parent, and a counted list by its name", () => {
    expect(
      describeMeta({
        sent: 1,
        firstTimers: { welcome: 0, invites: 2 },
        wouldSend: { count: 300 },
      }),
    ).toBe("1 sent · 0 first timers welcome · 2 first timers invites · 300 would send");
  });

  it("renders booleans and strings plainly", () => {
    expect(describeMeta({ dry: true, note: "held until 08:00" })).toBe(
      "dry: yes · note: held until 08:00",
    );
  });

  it("stops at the limit and says how many it left out", () => {
    const meta = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]));
    const line = describeMeta(meta, 10);
    expect(line.split(" · ")).toHaveLength(11);
    expect(line.endsWith("+3 more")).toBe(true);
  });
});

describe("words", () => {
  it("turns a key into words", () => {
    expect(words("churchesChecked")).toBe("churches checked");
    expect(words("stalledRecordings")).toBe("stalled recordings");
    expect(words("sms_sent")).toBe("sms sent");
    expect(words("sms")).toBe("sms");
  });
});
