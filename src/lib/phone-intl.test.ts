import { describe, expect, it } from "vitest";
import {
  e164Phone,
  internationalPhone,
  nationalNumber,
  phoneMatchCandidates,
  phoneMatchesQuery,
} from "@/lib/phone-intl";
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

/*
 * What a member, a visitor or a self-registration now stores and matches on.
 * The cases are the ones that refused real people: a Maputo member typing her
 * number the way everybody in Maputo writes it, a Kenyan typing the trunk zero.
 */
describe("storing a number as E.164", () => {
  it("stores a local number with the church's own dial code", () => {
    expect(e164Phone("84 123 4567", "258")).toBe("+258841234567");
    expect(e164Phone("0712 345 678", "254")).toBe("+254712345678");
    expect(e164Phone("024 123 4567", "233")).toBe("+233241234567");
  });

  it("leaves a Nigerian number what it always was, with a plus", () => {
    expect(e164Phone("0803 123 4567", "234")).toBe("+2348031234567");
    expect(e164Phone("2348031234567", "234")).toBe("+2348031234567");
  });

  it("believes a declared foreign number over the church's country", () => {
    expect(e164Phone("+44 7911 123456", "258")).toBe("+447911123456");
  });

  it("refuses what is not a number", () => {
    expect(e164Phone("12345", "254")).toBeNull();
    expect(e164Phone("", "254")).toBeNull();
  });

  it("does not invent a plus when no country code is known", () => {
    expect(e164Phone("8031234567", "")).toBe("8031234567");
    expect(e164Phone("+2348031234567", "")).toBe("+2348031234567");
  });
});

describe("the national number duplicate detection compares", () => {
  it("is the same for every shape a Mozambican number is stored in", () => {
    for (const shape of ["84 123 4567", "+258 84 123 4567", "084 123 4567", "258841234567"]) {
      expect(nationalNumber(shape, "258"), shape).toBe("841234567");
    }
  });

  it("is the same for a Kenyan number with and without its trunk zero", () => {
    expect(nationalNumber("0712345678", "254")).toBe("712345678");
    expect(nationalNumber("+254712345678", "254")).toBe("712345678");
  });

  it("is still the ten Nigerian digits the old match compared", () => {
    expect(nationalNumber("08031234567", "234")).toBe("8031234567");
    expect(nationalNumber("+234 803 123 4567", "234")).toBe("8031234567");
  });

  it("keeps a foreign number whole rather than guessing its country", () => {
    expect(nationalNumber("+44 7911 123456", "234")).toBe("447911123456");
  });

  it("is null for a slip of the thumb", () => {
    expect(nationalNumber("12345", "234")).toBeNull();
  });
});

/*
 * "Seven digits or more" was kinder to Maputo and worse for Lagos: a Nigerian
 * number one digit short was accepted and stored as nobody, and seven digits
 * counted as a whole national number — so a mistyped "8031234" matched any
 * member whose phone ended that way, and /join sent that member's code to a
 * stranger. A number in the church's own country is now held to its length.
 */
describe("a number held to its own country's length", () => {
  it("refuses a Nigerian number one digit short, as the SMS normaliser always has", () => {
    for (const typed of ["0803123456", "803123456", "+234803123456", "234803123456"]) {
      expect(normalizePhone(typed), typed).toBeNull();
      expect(internationalPhone(typed, "234"), typed).toBeNull();
      expect(e164Phone(typed, "234"), typed).toBeNull();
    }
  });

  it("refuses a Nigerian number one digit long", () => {
    expect(internationalPhone("080312345678", "234")).toBeNull();
  });

  it("never makes seven stray digits into a national number to match on", () => {
    expect(nationalNumber("8031234", "234")).toBeNull();
    expect(nationalNumber("0803 1234", "234")).toBeNull();
  });

  it("still takes every Mozambican shape, mobile and landline", () => {
    expect(internationalPhone("84 123 4567", "258")).toBe("258841234567");
    expect(internationalPhone("21 123 456", "258")).toBe("25821123456");
    expect(internationalPhone("8412345", "258")).toBeNull();
  });

  it("refuses a Kenyan number a digit short", () => {
    expect(internationalPhone("071234567", "254")).toBeNull();
    expect(internationalPhone("0712345678", "254")).toBe("254712345678");
  });

  it("leaves a declared foreign number to its own country's rules", () => {
    expect(internationalPhone("+44 7911 123456", "234")).toBe("447911123456");
    expect(nationalNumber("+44 7911 123456", "234")).toBe("447911123456");
  });

  it("refuses something longer than any number can be", () => {
    expect(internationalPhone("+1234567890123456", "234")).toBeNull();
  });
});

/*
 * The register now holds both "+2348031234567" (new rows) and "08031234567"
 * (older rows, Members → Add), and a search has to find a person either way.
 */
describe("searching the register by phone", () => {
  const stored = ["+2348031234567", "08031234567", "0803 123 4567", "2348031234567"];

  it("finds every stored shape from every typed shape", () => {
    for (const q of ["0803", "0803 123", "803123", "+234 803", "2348031234567", "08031234567"]) {
      for (const phone of stored) {
        expect(phoneMatchesQuery(phone, q, "234"), `${q} ~ ${phone}`).toBe(true);
      }
    }
  });

  it("finds a Mozambican number typed locally or internationally", () => {
    expect(phoneMatchesQuery("+258841234567", "84 123", "258")).toBe(true);
    expect(phoneMatchesQuery("841234567", "+258 84 123", "258")).toBe(true);
  });

  it("does not match a different number", () => {
    expect(phoneMatchesQuery("+2348031234567", "0805", "234")).toBe(false);
  });

  it("leaves names, emails and very short queries to the text search", () => {
    expect(phoneMatchesQuery("+2348031234567", "Ada", "234")).toBe(false);
    expect(phoneMatchesQuery("+2348031234567", "a@b.com", "234")).toBe(false);
    expect(phoneMatchesQuery("+2348031234567", "08", "234")).toBe(false);
    expect(phoneMatchesQuery(null, "0803", "234")).toBe(false);
  });
});
