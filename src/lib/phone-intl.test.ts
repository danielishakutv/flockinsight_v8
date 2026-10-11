import { describe, expect, it } from "vitest";
import { internationalPhone, phoneMatchCandidates } from "@/lib/phone-intl";
import { normalizePhone } from "@/lib/sms";

/**
 * The signup form now asks for a phone number, and every church that is not
 * Nigerian is the reason this file exists: `normalizePhone` refuses a nine-digit
 * Mozambican mobile outright, so the alternative to this helper was telling a
 * pastor in Maputo that his own number is wrong.
 */

describe("a Nigerian number", () => {
  it("agrees with the SMS normaliser, which is what Termii is given", () => {
    for (const typed of ["08031234567", "0803 123 4567", "+2348031234567", "2348031234567"]) {
      expect(internationalPhone(typed, "234"), typed).toBe(normalizePhone(typed));
    }
  });

  it("drops the trunk zero exactly once", () => {
    expect(internationalPhone("08031234567", "234")).toBe("2348031234567");
  });
});

describe("a number from a country with a shorter numbering plan", () => {
  it("accepts a nine-digit Mozambican mobile the SMS normaliser refuses", () => {
    expect(normalizePhone("821234567")).toBeNull();
    expect(internationalPhone("821234567", "258")).toBe("258821234567");
  });

  it("accepts an eight-digit Malian number", () => {
    expect(internationalPhone("76123456", "223")).toBe("22376123456");
  });

  it("does not mistake a national number that opens with the dial code", () => {
    // Mali's code is 223 and its national numbers are eight digits, so these
    // leading digits are a coincidence rather than a country code.
    expect(internationalPhone("22345678", "223")).toBe("22322345678");
  });

  it("leaves a genuinely international number alone", () => {
    expect(internationalPhone("223 76 12 34 56", "223")).toBe("22376123456");
  });
});

describe("what the person declared", () => {
  it("believes a leading plus over any guess about length", () => {
    expect(internationalPhone("+1 202 555 0143", "234")).toBe("12025550143");
  });

  it("treats 00 as the same declaration", () => {
    expect(internationalPhone("00447700900123", "234")).toBe("447700900123");
  });
});

describe("what it refuses", () => {
  it("refuses nothing at all", () => {
    expect(internationalPhone("", "234")).toBeNull();
    expect(internationalPhone(null, "234")).toBeNull();
    expect(internationalPhone("   ", "234")).toBeNull();
    expect(internationalPhone("not a number", "234")).toBeNull();
  });

  it("refuses a number too short to be anybody's", () => {
    // Six digits is a slip, and storing it would mean a church we cannot reach
    // while its record claims we can.
    expect(internationalPhone("080312", "234")).toBeNull();
    expect(internationalPhone("+1234", "1")).toBeNull();
  });

  it("still answers when no dial code is known", () => {
    expect(internationalPhone("8031234567", "")).toBe("8031234567");
  });
});

describe("matching a number already on file", () => {
  it("covers the shapes the same number could be stored in", () => {
    const got = phoneMatchCandidates("0803 123 4567", "234");
    expect(got).toContain("2348031234567");
    expect(got).toContain("+2348031234567");
    expect(got).toContain("08031234567");
    expect(got).toContain("8031234567");
  });

  it("is empty for nothing, so a query is never built from it", () => {
    expect(phoneMatchCandidates("", "234")).toEqual([]);
    expect(phoneMatchCandidates(null, "234")).toEqual([]);
  });

  it("never repeats a candidate", () => {
    const got = phoneMatchCandidates("2348031234567", "234");
    expect(new Set(got).size).toBe(got.length);
  });
});
