import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, unescapeCsvCell } from "./csv";

describe("toCsv", () => {
  it("quotes only what needs quoting", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', "line\nbreak"]])).toBe(
      'a,"b,c","say ""hi""","line\nbreak"',
    );
  });

  it("joins rows with CRLF", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
  });

  it("treats null as empty", () => {
    expect(toCsv([[null, 1]])).toBe(",1");
  });

  describe("spreadsheet formula injection", () => {
    it("neutralises a formula hidden in typed data", () => {
      expect(toCsv([['=HYPERLINK("http://evil","Click")']])).toBe(
        `"'=HYPERLINK(""http://evil"",""Click"")"`,
      );
      expect(toCsv([["=cmd|' /C calc'!A0"]])).toBe(`'=cmd|' /C calc'!A0`);
      expect(toCsv([["@SUM(A1:A9)"]])).toBe("'@SUM(A1:A9)");
      expect(toCsv([["\tstarts with a tab"]])).toBe("'\tstarts with a tab");
    });

    it("leaves plain numbers alone so totals still add up", () => {
      expect(toCsv([[-500]])).toBe("-500");
      expect(toCsv([["-500"]])).toBe("-500");
      expect(toCsv([["+12.5"]])).toBe("+12.5");
    });

    it("protects a phone number that would otherwise be read as a formula", () => {
      expect(toCsv([["+234 808 825 6055"]])).toBe("'+234 808 825 6055");
    });

    it("leaves ordinary text untouched", () => {
      expect(toCsv([["Grace Chapel"], ["Pastor Daniel"]])).toBe(
        "Grace Chapel\r\nPastor Daniel",
      );
    });
  });
});

describe("unescapeCsvCell", () => {
  it("undoes the export's apostrophe", () => {
    expect(unescapeCsvCell("'+234 808 825 6055")).toBe("+234 808 825 6055");
    expect(unescapeCsvCell("'=SUM(A1)")).toBe("=SUM(A1)");
  });

  it("keeps an apostrophe that belongs to the value", () => {
    expect(unescapeCsvCell("'Tis the season")).toBe("'Tis the season");
    expect(unescapeCsvCell("O'Brien")).toBe("O'Brien");
  });
});

describe("round trip", () => {
  it("survives export → parse → unescape", () => {
    const rows = [
      ["Church name", "Phone", "Notes"],
      ["Grace Chapel", "+234 808 825 6055", "Met at, the conference"],
      ["=Evil Church", "08088256055", 'Said "yes"'],
    ];
    const parsed = parseCsv(toCsv(rows)).map((r) => r.map(unescapeCsvCell));
    expect(parsed).toEqual(rows);
  });
});
