import { describe, expect, it } from "vitest";
import {
  bestReason,
  contributionPath,
  contributionUrl,
  daysUntil,
  deriveEntryStatus,
  derivePayoutStatus,
  dueLabel,
  effectiveTarget,
  emailKey,
  expectedFor,
  isShareableUrl,
  matchReasons,
  nameKey,
  outstandingFor,
  parseAmount,
  peopleStillNeeded,
  phoneKey,
  potTotals,
  progressPct,
  proofRejection,
  publicNames,
  everyNameHidden,
  shareMessage,
  shareText,
  SHARE_MAX_CHARS,
  splitName,
  summarisePerson,
  type EntryLike,
} from "@/lib/contributions-shared";

/**
 * These tests are about money and identity, which is the whole module.
 *
 * Two things are being guarded. One: a figure on a public page that twenty
 * people will compare against their own memory of what they paid — so an
 * unconfirmed claim must never be added into a total, and a disputed one must
 * not be cleared by the person who raised the figure. Two: a merge, which moves
 * one person's payments onto another person's record and is the only genuinely
 * destructive thing this feature can do.
 */

describe("deriveEntryStatus", () => {
  it("counts an entry once the pot's threshold is met", () => {
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 1, disputes: 0, required: 1 }),
    ).toBe("confirmed");
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 0, disputes: 0, required: 1 }),
    ).toBe("pending");
  });

  it("holds an entry back until a two-signature pot has two signatures", () => {
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 1, disputes: 0, required: 2 }),
    ).toBe("pending");
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 2, disputes: 0, required: 2 }),
    ).toBe("confirmed");
  });

  it("needs two confirmations to clear a dispute, even in a one-signature pot", () => {
    // The point of the rule: the person who wrote the figure down cannot
    // overrule the person who says it is wrong.
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 1, disputes: 1, required: 1 }),
    ).toBe("disputed");
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 2, disputes: 1, required: 1 }),
    ).toBe("confirmed");
  });

  it("needs more confirmations than disputes, not merely two of them", () => {
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 2, disputes: 2, required: 1 }),
    ).toBe("disputed");
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 3, disputes: 2, required: 1 }),
    ).toBe("confirmed");
  });

  it("keeps a pot's higher threshold in force while disputed", () => {
    // required=3 must not be relaxed to the dispute floor of 2.
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 2, disputes: 1, required: 3 }),
    ).toBe("disputed");
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 3, disputes: 1, required: 3 }),
    ).toBe("confirmed");
  });

  it("treats rejection as final, whatever the votes say", () => {
    expect(
      deriveEntryStatus({ rejected: true, confirmations: 9, disputes: 0, required: 1 }),
    ).toBe("rejected");
  });

  it("survives a nonsense threshold rather than counting nothing at all", () => {
    // A 0 or negative `required` would otherwise confirm everything with no
    // votes, which is the dangerous direction to fail in.
    expect(
      deriveEntryStatus({ rejected: false, confirmations: 0, disputes: 0, required: 0 }),
    ).toBe("pending");
  });
});

describe("derivePayoutStatus", () => {
  it("needs the pot's approvals before money may leave", () => {
    expect(
      derivePayoutStatus({ rejected: false, approvals: 1, disputes: 0, required: 2 }),
    ).toBe("pending");
    expect(
      derivePayoutStatus({ rejected: false, approvals: 2, disputes: 0, required: 2 }),
    ).toBe("approved");
  });

  it("lets a single objection hold money in", () => {
    // Unlike an entry, nothing is lost by waiting — the ledger has not moved.
    expect(
      derivePayoutStatus({ rejected: false, approvals: 5, disputes: 1, required: 2 }),
    ).toBe("pending");
  });
});

describe("potTotals", () => {
  const entries: EntryLike[] = [
    { amount: 5000, status: "confirmed" },
    { amount: 5000, status: "confirmed" },
    { amount: 3000, status: "pending" },
    { amount: 2000, status: "disputed" },
    { amount: 9999, status: "rejected" },
  ];

  it("counts only confirmed money as raised", () => {
    const t = potTotals(entries);
    expect(t.raised).toBe(10000);
    expect(t.pending).toBe(3000);
    expect(t.disputed).toBe(2000);
  });

  it("never counts a rejected entry anywhere", () => {
    const t = potTotals(entries);
    expect(t.raised + t.pending + t.disputed).toBe(15000);
  });

  it("takes only approved payouts off the balance", () => {
    const t = potTotals(entries, [
      { amount: 4000, status: "approved" },
      { amount: 6000, status: "pending" },
      { amount: 1000, status: "rejected" },
    ]);
    expect(t.paidOut).toBe(4000);
    expect(t.pendingOut).toBe(6000);
    expect(t.balance).toBe(6000);
  });

  it("reports zeroes for an empty pot rather than NaN", () => {
    const t = potTotals([], []);
    expect(t).toEqual({
      raised: 0,
      pending: 0,
      disputed: 0,
      paidOut: 0,
      pendingOut: 0,
      balance: 0,
    });
  });
});

describe("progress and goals", () => {
  it("caps the bar at 100% when a group overshoots", () => {
    expect(progressPct(250_000, 200_000)).toBe(100);
  });

  it("has no percentage without a goal", () => {
    expect(progressPct(50_000, null)).toBeNull();
    expect(progressPct(50_000, 0)).toBeNull();
  });

  it("infers a goal from the roster when nobody typed one", () => {
    expect(
      effectiveTarget({ targetAmount: null, perPersonAmount: 5000, expectedTotal: 200_000 }),
    ).toBe(200_000);
  });

  it("prefers the typed goal over the inferred one", () => {
    expect(
      effectiveTarget({ targetAmount: 150_000, perPersonAmount: 5000, expectedTotal: 200_000 }),
    ).toBe(150_000);
  });

  it("has no goal for an open-ended collection", () => {
    expect(
      effectiveTarget({ targetAmount: null, perPersonAmount: null, expectedTotal: 0 }),
    ).toBeNull();
  });

  it("says how many more people would close the gap", () => {
    expect(peopleStillNeeded(55_000, 5_000)).toBe(11);
    // Rounds up: ten and a half people is eleven people.
    expect(peopleStillNeeded(52_000, 5_000)).toBe(11);
    expect(peopleStillNeeded(0, 5_000)).toBeNull();
    expect(peopleStillNeeded(5_000, null)).toBeNull();
  });
});

describe("what one person owes", () => {
  it("prefers a person's own figure over the pot's", () => {
    expect(expectedFor(2000, 5000)).toBe(2000);
    expect(expectedFor(null, 5000)).toBe(5000);
    expect(expectedFor(null, null)).toBeNull();
  });

  it("keeps a zero expectation, because exempting somebody is a real decision", () => {
    expect(expectedFor(0, 5000)).toBe(0);
  });

  it("never reports a negative outstanding for somebody who overpaid", () => {
    expect(outstandingFor(5000, 7000)).toBe(0);
    expect(outstandingFor(5000, 2000)).toBe(3000);
    expect(outstandingFor(null, 2000)).toBe(0);
  });

  it("summarises a part-payer", () => {
    const s = summarisePerson({
      expected: 5000,
      entries: [
        { amount: 2000, status: "confirmed" },
        { amount: 1000, status: "pending" },
      ],
    });
    expect(s.paid).toBe(2000);
    expect(s.pending).toBe(1000);
    expect(s.outstanding).toBe(3000);
    expect(s.settled).toBe(false);
  });

  it("counts an open giver as settled once they have given anything", () => {
    const s = summarisePerson({
      expected: null,
      entries: [{ amount: 500, status: "confirmed" }],
    });
    expect(s.settled).toBe(true);
  });

  it("does not let a pending claim settle somebody", () => {
    const s = summarisePerson({
      expected: 5000,
      entries: [{ amount: 5000, status: "pending" }],
    });
    expect(s.outstanding).toBe(5000);
    expect(s.settled).toBe(false);
  });
});

describe("deadlines", () => {
  it("counts whole days", () => {
    expect(daysUntil("2026-10-12", "2026-10-02")).toBe(10);
    expect(daysUntil("2026-10-02", "2026-10-02")).toBe(0);
    expect(daysUntil("2026-09-28", "2026-10-02")).toBe(-4);
  });

  it("has nothing to say without a deadline", () => {
    expect(daysUntil(null, "2026-10-02")).toBeNull();
    expect(dueLabel(null, "2026-10-02")).toBeNull();
  });

  it("counts across a month and a year boundary", () => {
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysUntil("2026-11-01", "2026-10-31")).toBe(1);
  });

  it("reads in plain words, singular and plural", () => {
    expect(dueLabel("2026-10-02", "2026-10-02")).toBe("Due today");
    expect(dueLabel("2026-10-03", "2026-10-02")).toBe("1 day left");
    expect(dueLabel("2026-10-05", "2026-10-02")).toBe("3 days left");
    expect(dueLabel("2026-10-01", "2026-10-02")).toBe("1 day overdue");
    expect(dueLabel("2026-09-30", "2026-10-02")).toBe("2 days overdue");
  });
});

describe("nameKey", () => {
  it("sees through the honorifics a register is full of", () => {
    expect(nameKey("Sis. Grace Udo")).toBe(nameKey("Grace Udo"));
    expect(nameKey("Pastor Emeka Obi")).toBe(nameKey("emeka obi"));
    expect(nameKey("Deaconess  Mary   Bello")).toBe(nameKey("Mary Bello"));
  });

  it("sees through accents and word order", () => {
    expect(nameKey("Adéyẹmí Tunde")).toBe(nameKey("Tunde Adeyemi"));
  });

  it("does not collapse two different people", () => {
    expect(nameKey("Grace Udo")).not.toBe(nameKey("Grace Udoh"));
    expect(nameKey("John Paul")).not.toBe(nameKey("John Pauls"));
  });

  it("is empty for nothing, rather than matching everything", () => {
    // An empty key must never be treated as a match — see matchReasons.
    expect(nameKey("")).toBe("");
    expect(nameKey(null)).toBe("");
    expect(nameKey("Rev.")).toBe("");
  });
});

describe("phoneKey", () => {
  it("reduces every way a Nigerian number is written to one key", () => {
    expect(phoneKey("08031234567")).toBe("8031234567");
    expect(phoneKey("+2348031234567")).toBe("8031234567");
    expect(phoneKey("234 803 123 4567")).toBe("8031234567");
    expect(phoneKey("0803-123-4567")).toBe("8031234567");
  });

  it("ignores something too short to be a number", () => {
    expect(phoneKey("1234")).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe("emailKey", () => {
  it("lower-cases and trims", () => {
    expect(emailKey("  Grace@Example.COM ")).toBe("grace@example.com");
  });

  it("rejects something that is not an address", () => {
    expect(emailKey("not an email")).toBeNull();
    expect(emailKey(null)).toBeNull();
  });
});

describe("matchReasons", () => {
  const member = {
    firstName: "Grace",
    lastName: "Udo",
    phone: "08031234567",
    email: "grace@example.com",
  };

  it("matches on an email address", () => {
    expect(
      matchReasons({ name: "G. Udo", email: "GRACE@example.com" }, member),
    ).toContain("email");
  });

  it("matches on a phone number however it was typed", () => {
    expect(
      matchReasons({ name: "Unknown", phone: "+234 803 123 4567" }, member),
    ).toContain("phone");
  });

  it("matches on a full name after honorifics are stripped", () => {
    expect(matchReasons({ name: "Sister Grace Udo" }, member)).toEqual(["name"]);
  });

  it("refuses to match on a single first name", () => {
    // Half the women in a two-thousand-member church are a "Grace".
    expect(matchReasons({ name: "Grace" }, member)).toEqual([]);
  });

  it("finds nothing when nothing lines up", () => {
    expect(
      matchReasons(
        { name: "Peter Eze", phone: "08009999999", email: "peter@example.com" },
        member,
      ),
    ).toEqual([]);
  });

  it("does not match a contributor with no details at all", () => {
    expect(matchReasons({ name: "", phone: null, email: null }, member)).toEqual([]);
  });

  it("reports every reason, so the strongest can win", () => {
    const reasons = matchReasons(
      { name: "Grace Udo", phone: "08031234567", email: "grace@example.com" },
      member,
    );
    expect(reasons.sort()).toEqual(["email", "name", "phone"]);
    expect(bestReason(reasons)).toBe("email");
  });

  it("ranks a phone above a name and an email above a phone", () => {
    expect(bestReason(["name", "phone"])).toBe("phone");
    expect(bestReason(["phone", "email"])).toBe("email");
    expect(bestReason([])).toBeNull();
  });
});

describe("splitName", () => {
  it("splits a full name into a register's two fields", () => {
    expect(splitName("Grace Udo")).toEqual({ firstName: "Grace", lastName: "Udo" });
    expect(splitName("Mary Ann Bello")).toEqual({
      firstName: "Mary",
      lastName: "Ann Bello",
    });
  });

  it("accepts a single name, which plenty of registers hold", () => {
    expect(splitName("Blessing")).toEqual({ firstName: "Blessing", lastName: null });
  });

  it("does not trip over stray spacing", () => {
    expect(splitName("   Grace   Udo  ")).toEqual({
      firstName: "Grace",
      lastName: "Udo",
    });
  });
});

describe("amounts people type", () => {
  it("accepts the grouped numbers a phone keyboard produces", () => {
    expect(parseAmount("5,000")).toBe(5000);
    expect(parseAmount(" 5000 ")).toBe(5000);
    expect(parseAmount("2500.50")).toBe(2500.5);
    expect(parseAmount(7500)).toBe(7500);
  });

  it("refuses what is not a number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe("proof files", () => {
  it("accepts a phone photo and a bank PDF", () => {
    expect(proofRejection({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(proofRejection({ type: "application/pdf", size: 500_000 })).toBeNull();
  });

  it("turns away anything that is not a receipt", () => {
    expect(proofRejection({ type: "video/mp4", size: 1000 })).toMatch(/photo or a PDF/);
  });

  it("holds a PDF to a tighter ceiling, because it is stored as-is", () => {
    expect(proofRejection({ type: "application/pdf", size: 4_000_000 })).toMatch(/3 MB/);
    // The same size as an image is fine — it is re-encoded on the way in.
    expect(proofRejection({ type: "image/jpeg", size: 4_000_000 })).toBeNull();
  });

  it("turns away an image beyond the hard ceiling", () => {
    expect(proofRejection({ type: "image/jpeg", size: 9_000_000 })).toMatch(/8 MB/);
  });
});

describe("the link that gets shared", () => {
  /*
   * This shipped broken once and is the single most damaging bug this module
   * can have: the message goes to forty people, and half a link is a link
   * nobody can follow.
   *
   * The public page derived its URL from `window.location.origin`, which is
   * undefined during the server render — so the WhatsApp button was built with
   * a bare "/p/slug" and baked into the HTML. Anybody who tapped Share before
   * React hydrated sent "record yours: /p/anchor-monthly-contributions-nzahe".
   */
  it("is absolute, always", () => {
    const url = contributionUrl("choir-levy-ab12c", "https://flockinsight.com");
    expect(url).toBe("https://flockinsight.com/p/choir-levy-ab12c");
    expect(isShareableUrl(url)).toBe(true);
  });

  it("does not double the slash when the base carries one", () => {
    expect(contributionUrl("x", "https://flockinsight.com/")).toBe(
      "https://flockinsight.com/p/x",
    );
  });

  it("works for a local base too, so a dev link is still a whole link", () => {
    expect(contributionUrl("x", "http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000/p/x",
    );
  });

  it("rejects the bare path that caused the bug", () => {
    // The exact value the broken build put into people's messages.
    expect(isShareableUrl("/p/anchor-monthly-contributions-nzahe")).toBe(false);
    expect(isShareableUrl(contributionPath("choir-levy"))).toBe(false);
    expect(isShareableUrl("")).toBe(false);
    expect(isShareableUrl("flockinsight.com/p/x")).toBe(false);
    // A bare origin with nothing after it is not a link to a collection.
    expect(isShareableUrl("https://flockinsight.com/")).toBe(false);
  });

  it("never puts a bare path into a shared message", () => {
    const msg = shareMessage({
      title: "Choir levy",
      raised: "₦1",
      target: null,
      contributors: 1,
      url: contributionUrl("choir-levy-ab12c", "https://flockinsight.com"),
    });
    const shared = msg.split(/\s+/).find((w) => w.includes("/p/"))!;
    expect(isShareableUrl(shared)).toBe(true);
  });
});

describe("the WhatsApp message", () => {
  it("leads with the figure, because that is what the message is for", () => {
    const msg = shareMessage({
      title: "Choir uniform levy",
      raised: "₦145,000",
      target: "₦200,000",
      contributors: 23,
      url: "https://flockinsight.com/p/choir-uniform-levy-ab12c",
      dueLabel: "6 days left",
    });
    expect(msg).toContain("*Choir uniform levy*");
    expect(msg).toContain("₦145,000 of ₦200,000 so far — from 23 people.");
    expect(msg).toContain("6 days left.");
    expect(msg).toContain("https://flockinsight.com/p/choir-uniform-levy-ab12c");
  });

  it("reads correctly for one person and for no goal", () => {
    const msg = shareMessage({
      title: "Pastor's birthday gift",
      raised: "₦10,000",
      target: null,
      contributors: 1,
      url: "https://flockinsight.com/p/x",
    });
    expect(msg).toContain("₦10,000 so far — from 1 person.");
    expect(msg).not.toContain("undefined");
  });
});

/* ============================================================
 * Anonymity
 * ========================================================== */

const ROSTER = [
  { id: "a", name: "Grace Udo", isAnonymous: false },
  { id: "b", name: "Musa Bala", isAnonymous: true },
  { id: "c", name: "Esther Okon", isAnonymous: false },
  { id: "d", name: "Sunday Eze", isAnonymous: true },
];

describe("publicNames", () => {
  it("leaves a named person named, and hides the ones who asked", () => {
    const names = publicNames({ roster: ROSTER, hideNames: false });
    expect(names.get("a")).toEqual({ name: "Grace Udo", anonymous: false });
    expect(names.get("c")).toEqual({ name: "Esther Okon", anonymous: false });
    expect(names.get("b")!.anonymous).toBe(true);
    expect(names.get("d")!.anonymous).toBe(true);
  });

  it("never lets a hidden person's real name through", () => {
    const names = publicNames({ roster: ROSTER, hideNames: false });
    const published = [...names.values()].map((v) => v.name).join(" ");
    expect(published).not.toContain("Musa");
    expect(published).not.toContain("Sunday");
  });

  it("hides EVERY name when the pot says so, overriding each person's own flag", () => {
    /*
     * The failure this guards is specific and bad: a merge of the two settings
     * that left one person named because their own flag was off. The single
     * visible name in an otherwise anonymous list is more exposed than they
     * were before anybody touched the setting.
     */
    const names = publicNames({ roster: ROSTER, hideNames: true });
    for (const v of names.values()) expect(v.anonymous).toBe(true);
    const published = [...names.values()].map((v) => v.name).join(" ");
    expect(published).not.toContain("Grace");
    expect(published).not.toContain("Esther");
  });

  it("numbers hidden people so a long list can still be read and checked", () => {
    const names = publicNames({ roster: ROSTER, hideNames: true });
    expect([...names.values()].map((v) => v.name)).toEqual([
      "Anonymous 1",
      "Anonymous 2",
      "Anonymous 3",
      "Anonymous 4",
    ]);
  });

  it("does not number a single hidden person", () => {
    // A number on its own invites the question of who 1 is, and answers
    // nothing: there is no second row to tell it apart from.
    const names = publicNames({
      roster: [
        { id: "a", name: "Grace Udo", isAnonymous: false },
        { id: "b", name: "Musa Bala", isAnonymous: true },
      ],
      hideNames: false,
    });
    expect(names.get("b")!.name).toBe("Anonymous");
  });

  it("numbers in roster order, so the page and the message agree", () => {
    const names = publicNames({ roster: ROSTER, hideNames: false });
    expect(names.get("b")!.name).toBe("Anonymous 1");
    expect(names.get("d")!.name).toBe("Anonymous 2");
  });

  it("takes a translated label", () => {
    const names = publicNames({
      roster: ROSTER,
      hideNames: true,
      label: "Ba a sani ba",
    });
    expect(names.get("a")!.name).toBe("Ba a sani ba 1");
  });
});

describe("everyNameHidden", () => {
  it("is true when the setting is on", () => {
    expect(everyNameHidden({ hideNames: true, roster: ROSTER })).toBe(true);
  });

  it("is true when every single person chose it, setting or not", () => {
    expect(
      everyNameHidden({
        hideNames: false,
        roster: [
          { isAnonymous: true },
          { isAnonymous: true },
        ],
      }),
    ).toBe(true);
  });

  it("is false while one name still shows", () => {
    expect(everyNameHidden({ hideNames: false, roster: ROSTER })).toBe(false);
  });

  it("is false on an empty roster, not vacuously true", () => {
    /*
     * An empty list has no names to hide, and treating it as hidden would make
     * a brand new collection drop its "find my name" box for the first person
     * to open the link — exactly when they most need it.
     */
    expect(everyNameHidden({ hideNames: false, roster: [] })).toBe(false);
  });
});

/* ============================================================
 * The full WhatsApp update
 * ========================================================== */

function view(over: Partial<Parameters<typeof shareText>[0]> = {}) {
  return {
    title: "Choir uniform levy",
    churchName: "Grace Chapel",
    groupName: "Choir",
    purpose: "New uniforms for the harvest service",
    honoureeName: null,
    status: "open" as const,
    currency: "NGN",
    raised: 145_000,
    target: 200_000,
    paidOut: 0,
    balance: 145_000,
    givers: 23,
    people: 30,
    goalReached: false,
    dueLabel: "6 days left",
    payInstructions: "GTBank 0123456789 — Grace Chapel Choir",
    allowSelfReport: true,
    showPayouts: true,
    showOutstanding: false,
    ledger: [
      { name: "Grace Udo", amount: 10_000, status: "confirmed" as const },
      { name: "Anonymous 1", amount: 5_000, status: "confirmed" as const },
      { name: "Musa Bala", amount: 5_000, status: "pending" as const },
    ],
    stillToGive: [] as { name: string; outstanding: number }[],
    payouts: [] as {
      label: string;
      amount: number;
      status: "pending" | "approved" | "rejected";
    }[],
    url: "https://flockinsight.com/p/choir-uniform-levy-ab12c",
    ...over,
  };
}

describe("shareText", () => {
  it("sends the answer, not a link to the answer", () => {
    const msg = shareText(view());
    expect(msg).toContain("*Choir uniform levy*");
    expect(msg).toContain("Grace Chapel · Choir");
    expect(msg).toContain("From 23 of 30 people · 6 days left");
    expect(msg).toContain("Who has given");
    expect(msg).toContain("Grace Udo");
    expect(msg).toContain("How to pay");
    expect(msg).toContain("https://flockinsight.com/p/choir-uniform-levy-ab12c");
  });

  it("draws a bar whose length matches the percentage", () => {
    const msg = shareText(view());
    // 145,000 of 200,000 is 73%, which rounds to seven blocks of ten.
    expect(msg).toContain("▓▓▓▓▓▓▓░░░ 73%");
  });

  it("draws no bar when nobody set a goal", () => {
    const msg = shareText(view({ target: null, raised: 40_000 }));
    expect(msg).not.toContain("░");
    expect(msg).not.toContain("%");
  });

  it("marks money nobody has confirmed, so the lines add up to the total", () => {
    const msg = shareText(view());
    const line = msg.split("\n").find((l) => l.startsWith("Musa Bala"));
    expect(line).toContain("(awaiting)");
    const confirmed = msg.split("\n").find((l) => l.startsWith("Grace Udo"));
    expect(confirmed).not.toContain("awaiting");
  });

  it("never names anybody the page is hiding", () => {
    /*
     * The real protection is upstream — `publicNames` has already replaced the
     * names before they reach here, and a `summary` pot arrives with an empty
     * ledger. This is the assertion that the composer adds nothing back.
     */
    const msg = shareText(
      view({
        ledger: [
          { name: "Anonymous 1", amount: 10_000, status: "confirmed" },
          { name: "Anonymous 2", amount: 5_000, status: "confirmed" },
        ],
      }),
    );
    expect(msg).not.toContain("Grace Udo");
    expect(msg).toContain("Anonymous 1");
    expect(msg).toContain("Anonymous 2");
  });

  it("has no list at all when the pot publishes none", () => {
    // What `summary` visibility hands it: totals, no rows.
    const msg = shareText(view({ ledger: [] }));
    expect(msg).not.toContain("Who has given");
    expect(msg).toContain("From 23 of 30 people");
  });

  it("leaves out who still owes unless the church published it", () => {
    const owing = [{ name: "Esther Okon", outstanding: 2_000 }];
    expect(shareText(view({ stillToGive: owing }))).not.toContain("Esther Okon");
    expect(
      shareText(view({ stillToGive: owing, showOutstanding: true })),
    ).toContain("Esther Okon");
  });

  it("lists only approved money out, and says what is left", () => {
    const msg = shareText(
      view({
        paidOut: 40_000,
        balance: 105_000,
        payouts: [
          { label: "Fabric deposit", amount: 40_000, status: "approved" },
          { label: "Tailor, not yet agreed", amount: 15_000, status: "pending" },
        ],
      }),
    );
    expect(msg).toContain("Where the money went");
    expect(msg).toContain("Fabric deposit");
    expect(msg).not.toContain("not yet agreed");
    expect(msg).toContain("Left in the pot: ₦105,000");
  });

  it("drops the whole money-out section when the church turned it off", () => {
    const msg = shareText(
      view({
        showPayouts: false,
        paidOut: 40_000,
        payouts: [{ label: "Fabric deposit", amount: 40_000, status: "approved" }],
      }),
    );
    expect(msg).not.toContain("Where the money went");
    expect(msg).not.toContain("Fabric deposit");
  });

  it("says to record yours only when the form is open", () => {
    expect(shareText(view())).toContain("record yours");
    expect(shareText(view({ allowSelfReport: false }))).not.toContain(
      "record yours",
    );
  });

  it("names a gift's honouree", () => {
    const msg = shareText(view({ honoureeName: "Pastor Mrs Udo" }));
    expect(msg).toContain("For Pastor Mrs Udo");
  });

  it("reads correctly for one giver and no roster", () => {
    const msg = shareText(view({ givers: 1, people: 0 }));
    expect(msg).toContain("From 1 person");
    expect(msg).not.toContain("1 people");
  });

  it("stays inside a URL's budget, and says how many rows it left out", () => {
    /*
     * The message is percent-encoded into a wa.me URL, which roughly triples
     * it. Trimming here is visible; trimming in the browser cuts a name in
     * half and tells nobody.
     */
    const many = Array.from({ length: 60 }, (_, i) => ({
      name: `Contributor with quite a long name number ${i}`,
      amount: 5_000,
      status: "confirmed" as const,
    }));
    const msg = shareText(view({ ledger: many }));
    expect(msg.length).toBeLessThanOrEqual(SHARE_MAX_CHARS);
    expect(msg).toMatch(/and \d+ more on the page/);
    // The link survives the trimming, because without it the message is a dead end.
    expect(msg).toContain("https://flockinsight.com/p/choir-uniform-levy-ab12c");
    expect(msg).toContain("How to pay");
  });

  it("drops a trailing .00 but never drops real kobo", () => {
    /*
     * Eight lines of "₦10,000.00" is noise around the figure that matters, and
     * rounding 1,500.50 to 1,501 would make the lines stop adding up to the
     * total above them.
     */
    const msg = shareText(
      view({
        raised: 10_000,
        target: 20_000,
        ledger: [
          { name: "Grace Udo", amount: 8_499.5, status: "confirmed" },
          { name: "Musa Bala", amount: 1_500.5, status: "confirmed" },
        ],
      }),
    );
    expect(msg).toContain("₦10,000 of ₦20,000");
    expect(msg).toContain("₦8,499.50");
    expect(msg).toContain("₦1,500.50");
  });

  it("flattens a multi-line pay instruction into the message", () => {
    const msg = shareText(
      view({ payInstructions: "GTBank\n0123456789\nGrace Chapel Choir" }),
    );
    expect(msg).toContain("GTBank 0123456789 Grace Chapel Choir");
  });

  it("says when a collection has closed or settled", () => {
    expect(shareText(view({ status: "closed" }))).toContain("no longer collecting");
    expect(shareText(view({ status: "settled" }))).toContain("Settled");
  });

  it("takes every word from the caller, so it can be sent in any language", () => {
    const msg = shareText(view(), {
      whoHasGiven: "Wanda ya bayar",
      seeAndRecord: "Duba komai:",
    });
    expect(msg).toContain("*Wanda ya bayar*");
    expect(msg).toContain("Duba komai:");
    expect(msg).not.toContain("Who has given");
  });

  it("never leaves a placeholder or an undefined showing", () => {
    const msg = shareText(view());
    expect(msg).not.toContain("undefined");
    expect(msg).not.toMatch(/\{\w+\}/);
  });
});
