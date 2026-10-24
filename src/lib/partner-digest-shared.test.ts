import { describe, expect, it } from "vitest";
import {
  composeDigest,
  digestSegment,
  digestSlotFor,
  digestSlotIndex,
  nextDigestAt,
  whatsappInvite,
  type DigestFacts,
} from "@/lib/partner-digest-shared";

/** A Partner with nothing yet; each test changes only what it is about. */
const base: DigestFacts = {
  displayName: "Ada Obi",
  status: "active",
  code: "BC3K9M",
  shareLink: "https://flockinsight.com/a/BC3K9M",
  churchesSigned: 0,
  churchesEverPaid: 0,
  notYetPaying: [],
  liveChurches: 0,
  newSinceLast: 0,
  earnedSinceLast: 0,
  available: 0,
  lifetime: 0,
  daysSinceLastSignup: null,
  tier: { name: "Partner", firstBps: 4000, secondBps: 4000 },
  next: { name: "Senior Partner", needed: 5, firstBps: 4500 },
  minPayout: 10_000,
  hasBank: true,
  emailVerified: true,
  phoneVerified: true,
  openRequest: false,
  examplePlan: { name: "Growth", monthly: 10_000 },
};

const all = (e: ReturnType<typeof composeDigest>) => [e.subject, e.heading, ...e.paragraphs, e.tip].join(" ");

describe("when the progress email goes", () => {
  it("goes on Monday and Thursday mornings, Lagos time", () => {
    // 2026-10-26 is a Monday. 08:15 UTC is 09:15 in Lagos.
    expect(digestSlotFor(new Date("2026-10-26T08:15:00Z"))).toBe("2026-10-26");
    expect(digestSlotFor(new Date("2026-10-29T08:15:00Z"))).toBe("2026-10-29");
  });

  it("does not go on any other day", () => {
    for (const d of ["2026-10-25", "2026-10-27", "2026-10-28", "2026-10-30", "2026-10-31"]) {
      expect(digestSlotFor(new Date(`${d}T10:15:00Z`))).toBeNull();
    }
  });

  it("does not go before 9am or after 7pm in Lagos", () => {
    expect(digestSlotFor(new Date("2026-10-26T07:15:00Z"))).toBeNull(); // 08:15 Lagos
    expect(digestSlotFor(new Date("2026-10-26T17:59:00Z"))).toBe("2026-10-26"); // 18:59
    expect(digestSlotFor(new Date("2026-10-26T18:15:00Z"))).toBeNull(); // 19:15
  });

  it("uses the Lagos date, not the UTC one, near midnight", () => {
    // Sunday 23:30 UTC is already Monday 00:30 in Lagos — but too early to send.
    expect(digestSlotFor(new Date("2026-10-25T23:30:00Z"))).toBeNull();
  });

  it("names the same slot for every tick of the day, so the claim holds", () => {
    const a = digestSlotFor(new Date("2026-10-26T08:15:00Z"));
    const b = digestSlotFor(new Date("2026-10-26T15:15:00Z"));
    expect(a).toBe(b);
  });

  it("counts send days one after another, so Monday and Thursday differ", () => {
    const mon = digestSlotIndex("2026-10-26");
    const thu = digestSlotIndex("2026-10-29");
    const nextMon = digestSlotIndex("2026-11-02");
    expect(thu).toBe(mon + 1);
    expect(nextMon).toBe(mon + 2);
  });

  it("knows the next send", () => {
    // Saturday afternoon → Monday 09:00 Lagos (08:00 UTC).
    expect(nextDigestAt(new Date("2026-10-24T15:00:00Z")).toISOString()).toBe(
      "2026-10-26T08:00:00.000Z",
    );
    // Monday 10:00 Lagos, after the send → Thursday.
    expect(nextDigestAt(new Date("2026-10-26T09:00:00Z")).toISOString()).toBe(
      "2026-10-29T08:00:00.000Z",
    );
  });
});

describe("which email a Partner gets", () => {
  it("encourages a Partner with no churches", () => {
    expect(digestSegment(base)).toBe("first_steps");
  });

  it("helps a Partner whose churches signed up but have not paid", () => {
    expect(digestSegment({ ...base, churchesSigned: 2, notYetPaying: ["A", "B"] })).toBe("activate");
  });

  it("counts PAYING churches, not sign-ups", () => {
    // Ten sign-ups and no payments is still "help them start", not progress.
    expect(digestSegment({ ...base, churchesSigned: 10 })).toBe("activate");
    expect(digestSegment({ ...base, churchesSigned: 3, churchesEverPaid: 1, liveChurches: 1 })).toBe(
      "growing",
    );
  });

  it("celebrates the top of the ladder", () => {
    expect(
      digestSegment({ ...base, churchesSigned: 45, churchesEverPaid: 42, liveChurches: 41, next: null }),
    ).toBe("top");
  });
});

describe("what the email says", () => {
  it("gives a Partner with no churches their link, a message to forward, and what one church earns", () => {
    const e = composeDigest(base, 0);
    const text = all(e);
    expect(text).toContain(base.shareLink);
    expect(text).toContain(whatsappInvite(base.shareLink));
    // 40% of ₦10,000.
    expect(text).toMatch(/₦4,000/);
    expect(e.tip.length).toBeGreaterThan(20);
  });

  it("names up to three churches waiting to start, and counts the rest", () => {
    const e = composeDigest(
      { ...base, churchesSigned: 5, notYetPaying: ["Grace", "Hope", "Faith", "Joy", "Peace"] },
      0,
    );
    const text = all(e);
    expect(text).toContain("Grace, Hope, Faith and 2 more");
    expect(text).not.toContain("Joy");
  });

  it("tells a climbing Partner how far the next tier is", () => {
    const e = composeDigest(
      { ...base, churchesSigned: 4, churchesEverPaid: 3, liveChurches: 3, next: { name: "Senior Partner", needed: 2, firstBps: 4500 } },
      0,
    );
    expect(all(e)).toContain("2 more churches and you reach Senior Partner at 45%");
  });

  it("leads with money earned since last time, when there is some", () => {
    const e = composeDigest(
      { ...base, churchesSigned: 2, churchesEverPaid: 1, liveChurches: 1, earnedSinceLast: 4000 },
      0,
    );
    expect(e.subject).toContain("₦4,000");
  });

  it("asks a Partner whose churches all lapsed to check in, not to celebrate", () => {
    const e = composeDigest({ ...base, churchesSigned: 3, churchesEverPaid: 2, liveChurches: 0 }, 0);
    expect(e.heading).toMatch(/check in/i);
  });

  it("notices a quiet spell", () => {
    const e = composeDigest(
      { ...base, churchesSigned: 2, churchesEverPaid: 1, liveChurches: 1, daysSinceLastSignup: 41 },
      0,
    );
    expect(all(e)).toContain("41 days since your last church signed up");
  });

  it("says what stands between them and money they have earned", () => {
    const ready = { ...base, churchesSigned: 2, churchesEverPaid: 2, liveChurches: 2, available: 15_000 };
    expect(all(composeDigest({ ...ready, hasBank: false }, 0))).toMatch(/Add your bank account/);
    expect(composeDigest({ ...ready, hasBank: false }, 0).cta.label).toBe("Add your bank account");
    expect(all(composeDigest({ ...ready, phoneVerified: false }, 0))).toMatch(/Confirm your phone/);
    expect(all(composeDigest(ready, 0))).toMatch(/you can withdraw it/);
    expect(all(composeDigest({ ...ready, openRequest: true }, 0))).toMatch(/being processed/);
    // Under the minimum: nothing about withdrawing at all.
    expect(all(composeDigest({ ...ready, available: 5_000 }, 0))).not.toMatch(/withdraw/i);
  });

  it("reminds a pending Partner that earnings are recorded while they wait", () => {
    expect(all(composeDigest({ ...base, status: "pending" }, 0))).toMatch(/waiting for approval/);
  });

  it("rotates the tip and subject between send days", () => {
    const mon = composeDigest(base, 10);
    const thu = composeDigest(base, 11);
    expect(mon.tip).not.toBe(thu.tip);
    expect(mon.subject).not.toBe(thu.subject);
  });

  it("never prints undefined, NaN or an empty sentence, whatever the figures", () => {
    const cases: DigestFacts[] = [
      base,
      { ...base, examplePlan: null },
      { ...base, churchesSigned: 1, notYetPaying: [] },
      { ...base, churchesSigned: 1, churchesEverPaid: 1, liveChurches: 1, next: null },
      { ...base, displayName: "" },
    ];
    for (const f of cases) {
      for (let i = 0; i < 6; i++) {
        const e = composeDigest(f, i);
        expect(all(e)).not.toMatch(/undefined|NaN|null/);
        for (const p of e.paragraphs) expect(p.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
