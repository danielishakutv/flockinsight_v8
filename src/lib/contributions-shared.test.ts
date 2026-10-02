import { describe, expect, it } from "vitest";
import {
  bestReason,
  daysUntil,
  deriveEntryStatus,
  derivePayoutStatus,
  dueLabel,
  effectiveTarget,
  emailKey,
  expectedFor,
  matchReasons,
  nameKey,
  outstandingFor,
  parseAmount,
  peopleStillNeeded,
  phoneKey,
  potTotals,
  progressPct,
  proofRejection,
  shareMessage,
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
