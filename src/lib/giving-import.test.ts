import { describe, expect, it } from "vitest";
import {
  countGifts,
  giftKey,
  splitAlreadyRecorded,
  type GiftKeyParts,
} from "@/lib/giving-import";

/**
 * Importing a giving file twice must not double the money, and importing it
 * once must not lose any.
 */

function gift(over: Partial<GiftKeyParts> = {}): GiftKeyParts {
  return {
    date: "2026-03-01",
    amount: 1000,
    giver: null,
    categoryId: "cat-offering",
    projectId: null,
    method: "cash",
    note: null,
    ...over,
  };
}

function split(file: GiftKeyParts[], ledger: GiftKeyParts[]) {
  return splitAlreadyRecorded(file, giftKey, countGifts(ledger));
}

describe("splitAlreadyRecorded", () => {
  const file = [
    gift({ giver: "Ada Obi", amount: 5000, categoryId: "cat-tithe" }),
    gift(),
    gift(),
    gift({ date: "2026-03-08", amount: 2500, method: "transfer" }),
  ];

  it("adds nothing the second time the same file comes in", () => {
    // A retry after the response was lost once the import had committed.
    const { add, already } = split(file, file);
    expect(add).toHaveLength(0);
    expect(already).toHaveLength(file.length);
  });

  it("imports two identical gifts on a first import", () => {
    // Two anonymous ₦1,000 cash offerings on one Sunday share every field.
    // Skipping the second would drop real money without a word.
    const { add } = split(file, []);
    expect(add).toHaveLength(file.length);
  });

  it("counts: only as many rows are recorded already as the ledger holds", () => {
    const { add, already } = split([gift(), gift(), gift()], [gift(), gift()]);
    expect(already).toHaveLength(2);
    expect(add).toHaveLength(1);
  });

  it("adds only the new month from an overlapping file", () => {
    const march = [gift(), gift({ amount: 2000 })];
    const april = [gift({ date: "2026-04-05" })];
    const { add } = split([...march, ...april], march);
    expect(add).toEqual(april);
  });

  it("does not change the ledger counts it was given", () => {
    const counts = countGifts([gift()]);
    splitAlreadyRecorded([gift()], giftKey, counts);
    expect(counts.get(giftKey(gift()))).toBe(1);
  });
});

describe("giftKey", () => {
  it("reads 5000 and 5000.00 as one amount", () => {
    expect(giftKey(gift({ amount: 5000 }))).toBe(giftKey(gift({ amount: 5000.0 })));
    expect(giftKey(gift({ amount: 5000 }))).not.toBe(giftKey(gift({ amount: 5000.5 })));
  });

  it("finds a gift through a spreadsheet's spacing and capitals", () => {
    expect(giftKey(gift({ giver: "  Ada Obi " }))).toBe(giftKey(gift({ giver: "ada obi" })));
    expect(giftKey(gift({ note: "Envelope 12" }))).toBe(giftKey(gift({ note: "envelope 12 " })));
  });

  it("treats a blank giver or note as none", () => {
    expect(giftKey(gift({ giver: "" }))).toBe(giftKey(gift({ giver: null })));
    expect(giftKey(gift({ note: "   " }))).toBe(giftKey(gift({ note: null })));
  });

  it("compares a long note the way the import clips it", () => {
    const long = "x".repeat(600);
    expect(giftKey(gift({ note: long }))).toBe(giftKey(gift({ note: long.slice(0, 500) })));
  });

  it("keeps gifts apart on every field that tells them apart", () => {
    const base = giftKey(gift());
    for (const over of [
      { date: "2026-03-02" },
      { amount: 1001 },
      { giver: "Ada Obi" },
      { categoryId: "cat-tithe" },
      { categoryId: null },
      { projectId: "proj-roof" },
      { method: "transfer" },
      { method: null },
      { note: "Envelope 13" },
    ] satisfies Partial<GiftKeyParts>[]) {
      expect(giftKey(gift(over)), JSON.stringify(over)).not.toBe(base);
    }
  });
});
