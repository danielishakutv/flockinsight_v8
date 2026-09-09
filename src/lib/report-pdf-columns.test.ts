import { describe, expect, it } from "vitest";
import {
  cellLimit,
  columnWeights,
  humanize,
  isIdColumn,
  pdfColumns,
  short,
} from "@/lib/report-pdf-columns";

/** The real members dataset, which is the one that showed the problem. */
const MEMBER_COLUMNS = [
  "member_id",
  "first_name",
  "middle_name",
  "last_name",
  "full_name",
  "gender",
  "status",
  "phone",
  "email",
  "date_of_birth",
  "age",
  "joined_at",
  "is_minor",
  "guardian_id",
  "guardian_name",
  "household_id",
  "household_name",
];

describe("isIdColumn", () => {
  it("catches the id columns the export carries for joining", () => {
    expect(isIdColumn("member_id")).toBe(true);
    expect(isIdColumn("guardian_id")).toBe(true);
    expect(isIdColumn("household_id")).toBe(true);
    expect(isIdColumn("id")).toBe(true);
  });

  it("leaves alone columns that merely contain the letters", () => {
    // These are real column names elsewhere in the catalogue. Matching them
    // would silently drop content people need.
    expect(isIdColumn("identifier")).toBe(false);
    expect(isIdColumn("paid")).toBe(false);
    expect(isIdColumn("is_minor")).toBe(false);
    expect(isIdColumn("id_number")).toBe(false);
    expect(isIdColumn("valid")).toBe(false);
  });
});

describe("pdfColumns", () => {
  it("drops every id and keeps the rest in order", () => {
    const idx = pdfColumns(MEMBER_COLUMNS, 50);
    const names = idx.map((i) => MEMBER_COLUMNS[i]);
    expect(names).not.toContain("member_id");
    expect(names).not.toContain("guardian_id");
    expect(names).not.toContain("household_id");
    expect(names[0]).toBe("first_name");
    expect(names).toContain("household_name");
    expect(names).toHaveLength(MEMBER_COLUMNS.length - 3);
  });

  it("counts the cap against readable columns, not the ids it dropped", () => {
    // The point of the cap is how many fit on the page. Ids never reach it,
    // so they must not use up the allowance.
    const idx = pdfColumns(MEMBER_COLUMNS, 5);
    expect(idx).toHaveLength(5);
    expect(idx.map((i) => MEMBER_COLUMNS[i])).toEqual([
      "first_name",
      "middle_name",
      "last_name",
      "full_name",
      "gender",
    ]);
  });

  it("returns indexes into the ORIGINAL column list", () => {
    // The renderer reads row[i], so an index that lost track of the dropped
    // id columns would print the wrong value under the right heading.
    const idx = pdfColumns(MEMBER_COLUMNS, 3);
    expect(idx).toEqual([1, 2, 3]);
  });

  it("copes with a dataset that is all ids", () => {
    expect(pdfColumns(["member_id", "group_id"], 12)).toEqual([]);
  });
});

describe("columnWeights", () => {
  const cols = ["age", "full_name", "street"];
  const rows = [
    ["31", "Grace Adeyemi", "14 Herbert Macaulay Way, Yaba"],
    ["7", "Chinedu Okafor", "3 Allen Avenue"],
  ];

  it("gives a wide column more room than a narrow one", () => {
    const [age, name, street] = columnWeights(cols, rows, [0, 1, 2]);
    expect(street).toBeGreaterThan(name);
    expect(name).toBeGreaterThan(age);
  });

  it("never lets a column collapse below a readable minimum", () => {
    const w = columnWeights(["age"], [["1"]], [0]);
    expect(w[0]).toBeGreaterThanOrEqual(6);
  });

  it("caps a runaway column so it cannot squeeze the others out", () => {
    const long = "x".repeat(4000);
    const w = columnWeights(["note"], [[long]], [0]);
    expect(w[0]).toBeLessThanOrEqual(26);
  });

  it("sizes to the header when the data is narrower than it", () => {
    const w = columnWeights(["relationship_to_guardian"], [["son"]], [0]);
    // "Relationship to guardian" is 24 characters — the header, not "son",
    // is what has to fit.
    expect(w[0]).toBeGreaterThan(20);
  });

  it("only samples the rows it is told to, for speed", () => {
    const rowsMany = [["short"], ...Array.from({ length: 500 }, () => ["a".repeat(80)])];
    const sampled = columnWeights(["c"], rowsMany, [0], 1);
    expect(sampled[0]).toBeLessThan(20);
  });

  it("treats an empty dataset as header-width", () => {
    expect(columnWeights(["phone"], [], [0])[0]).toBeGreaterThanOrEqual(6);
  });
});

describe("cellLimit and short", () => {
  it("truncates to something that fits the column", () => {
    const limit = cellLimit(10);
    expect(short("x".repeat(100), limit)).toHaveLength(limit);
    expect(short("x".repeat(100), limit).endsWith("…")).toBe(true);
  });

  it("leaves a value that already fits untouched", () => {
    expect(short("Grace", 20)).toBe("Grace");
  });

  it("renders null as empty rather than the word null", () => {
    expect(short(null)).toBe("");
  });

  it("keeps numbers intact", () => {
    expect(short(31)).toBe("31");
  });
});

describe("humanize", () => {
  it("turns a column name into a heading", () => {
    expect(humanize("date_of_birth")).toBe("Date of birth");
    expect(humanize("full_name")).toBe("Full name");
  });
});
