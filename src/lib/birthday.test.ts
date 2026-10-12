import { describe, expect, it } from "vitest";
import {
  buildBirthday,
  daysInBirthMonth,
  isStorableDate,
  normalizeBirthday,
} from "@/lib/birthday";

/**
 * Every date built here goes into a Postgres `date` column, which refuses a
 * day that did not exist. "29 Feb 1990" used to be offered, built, and then
 * refused — the member save failed with a generic error, a CSV import lost the
 * whole file, and on the public form a child silently was not registered.
 */

describe("isStorableDate", () => {
  it("agrees with Postgres about leap days", () => {
    expect(isStorableDate("2000-02-29")).toBe(true);
    expect(isStorableDate("2024-02-29")).toBe(true);
    expect(isStorableDate("1990-02-29")).toBe(false);
    expect(isStorableDate("1900-02-29")).toBe(false);
  });

  it("accepts the year-unknown sentinel, which Date.UTC would misread as 1904", () => {
    expect(isStorableDate("0004-02-29")).toBe(true);
  });

  it("refuses year 0, which Postgres does not have", () => {
    expect(isStorableDate("0000-03-01")).toBe(false);
  });

  it("refuses impossible days and bad shapes", () => {
    expect(isStorableDate("2023-09-31")).toBe(false);
    expect(isStorableDate("2023-13-01")).toBe(false);
    expect(isStorableDate("2023-9-1")).toBe(false);
    expect(isStorableDate("")).toBe(false);
    expect(isStorableDate(null)).toBe(false);
  });
});

describe("buildBirthday", () => {
  it("clamps 29 Feb to 28 Feb in a year that had no 29th", () => {
    expect(buildBirthday("02", "29", "1990")).toBe("1990-02-28");
  });

  it("keeps 29 Feb in a leap year and with no year", () => {
    expect(buildBirthday("02", "29", "2000")).toBe("2000-02-29");
    expect(buildBirthday("02", "29", "")).toBe("0004-02-29");
  });

  it("treats year 0000 as no year rather than a date Postgres refuses", () => {
    expect(buildBirthday("03", "01", "0000")).toBe("0004-03-01");
  });

  it("only ever produces a storable date", () => {
    for (const y of ["", "1990", "2000", "1900", "0000", "0004", "12"]) {
      for (let m = 1; m <= 12; m++) {
        for (const d of ["28", "29", "30", "31"]) {
          const iso = buildBirthday(String(m), d, y);
          expect(isStorableDate(iso), `${y}-${m}-${d} -> ${iso}`).toBe(true);
        }
      }
    }
  });
});

describe("daysInBirthMonth", () => {
  it("offers 29 February only when the year allows it", () => {
    expect(daysInBirthMonth("02")).toBe(29);
    expect(daysInBirthMonth("02", "")).toBe(29);
    expect(daysInBirthMonth("02", "1990")).toBe(28);
    expect(daysInBirthMonth("02", "2024")).toBe(29);
    expect(daysInBirthMonth("02", "199")).toBe(29); // still being typed
  });
});

describe("normalizeBirthday", () => {
  it("never returns a date Postgres will refuse", () => {
    expect(normalizeBirthday("1990-02-29")).toBeNull();
    expect(normalizeBirthday("02-29")).toBe("0004-02-29");
    expect(normalizeBirthday("2000-02-29")).toBe("2000-02-29");
  });

  /*
   * Text from a spreadsheet is not clamped: "1990-04-31" quietly became the
   * 30th, a birthday on a day that is nobody's. Null lets the import name it.
   */
  it("refuses a day the month does not have, rather than moving it", () => {
    expect(normalizeBirthday("1990-04-31")).toBeNull();
    expect(normalizeBirthday("04/31")).toBeNull();
    expect(normalizeBirthday("1990-04-30")).toBe("1990-04-30");
  });
});
