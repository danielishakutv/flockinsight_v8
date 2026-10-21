import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { MEMBER_CSV_HEADERS, normalizeDate } from "@/lib/members-data";
import { addPhoneOwner, personKey, planMemberImport, type PhoneOwners } from "@/lib/member-import";

/**
 * Export, edit in a spreadsheet, import back: the supported round trip that
 * used to save the export's formula-guard apostrophe into people's phone
 * numbers, drop every child's guardian, and double the register on a second
 * run.
 */

function row(over: Partial<Record<(typeof MEMBER_CSV_HEADERS)[number], string>>) {
  return MEMBER_CSV_HEADERS.map((h) => over[h] ?? "");
}

function plan(
  rows: string[][],
  dial = "234",
  existing: { emails?: string[]; phones?: [national: string, firstName: string][] } = {},
) {
  const phones: PhoneOwners = new Map();
  for (const [n, name] of existing.phones ?? []) addPhoneOwner(phones, n, name);
  return planMemberImport(parseCsv(toCsv([[...MEMBER_CSV_HEADERS], ...rows])), {
    dial,
    existingEmails: new Set(existing.emails ?? []),
    existingPhones: phones,
    maxRows: 5000,
  });
}

describe("the export's apostrophe", () => {
  it("is taken off again on the way back in", () => {
    // The export really does guard these: they start with "+" and are not plain numbers.
    expect(toCsv([["+234 808 825 6055"]])).toBe("'+234 808 825 6055");

    const p = plan([
      row({ "First name": "Ada", Phone: "+234 808 825 6055", Notes: "-moved from Yola" }),
    ]);
    expect(p.rows[0].values.phone).toBe("+2348088256055");
    expect(p.rows[0].values.notes).toBe("-moved from Yola");
  });

  it("leaves a Mozambican number intact in a Mozambican church", () => {
    const p = plan([row({ "First name": "Ana", Phone: "+258 84 123 4567" })], "258");
    expect(p.rows[0].values.phone).toBe("+258841234567");
  });

  it("reads a local number with the church's own dial code", () => {
    const p = plan([row({ "First name": "Ana", Phone: "84 123 4567" })], "258");
    expect(p.rows[0].values.phone).toBe("+258841234567");
  });
});

describe("children", () => {
  it("come back as children, with the guardian named for linking", () => {
    const p = plan([
      row({ "First name": "Tobi", Child: "Yes", Guardian: "Ada Obi", Relationship: "son" }),
    ]);
    expect(p.rows[0].values.isMinor).toBe(true);
    expect(p.rows[0].values.relationship).toBe("son");
    expect(p.rows[0].guardianName).toBe("Ada Obi");
  });

  it("an adult row carries no guardian even if the cell has one", () => {
    const p = plan([row({ "First name": "Ada", Guardian: "Somebody" })]);
    expect(p.rows[0].values.isMinor).toBe(false);
    expect(p.rows[0].guardianName).toBeNull();
  });
});

describe("people already on the register", () => {
  it("are skipped by email or by phone, and named", () => {
    const p = plan(
      [
        row({ "First name": "Ada", Email: "ADA@example.com" }),
        row({ "First name": "Bola", Phone: "0803 123 4567" }),
        row({ "First name": "Chi", Phone: "08099999999" }),
      ],
      "234",
      { emails: ["ada@example.com"], phones: [["8031234567", "BOLA"]] },
    );
    expect(p.rows.map((r) => r.values.firstName)).toEqual(["Chi"]);
    expect(p.duplicates).toBe(2);
    expect(p.skipped).toBe(2);
    expect(p.errors.join("\n")).toMatch(/Row 2: Ada is already on the register \(same email\)/);
    expect(p.errors.join("\n")).toMatch(
      /Row 3: Bola is already on the register \(same phone and first name\)/,
    );
  });

  /*
   * A husband and wife, a mother and her son: one handset, two people. A
   * phone-only rule skipped the second as "already on the register", which in
   * a first-ever import is a real person silently left out.
   */
  it("are NOT a family sharing one phone", () => {
    const p = plan([
      row({ "First name": "Emeka", Phone: "0803 123 4567" }),
      row({ "First name": "Ngozi", Phone: "+234 803 123 4567" }),
    ]);
    expect(p.rows.map((r) => r.values.firstName)).toEqual(["Emeka", "Ngozi"]);
    expect(p.duplicates).toBe(0);
    expect(p.errors.join("\n")).toMatch(/Row 3: Ngozi shares a phone number/);
  });

  it("are not somebody new on a phone already on the register", () => {
    const p = plan([row({ "First name": "Ngozi", Phone: "08031234567" })], "234", {
      phones: [["8031234567", "Emeka"]],
    });
    expect(p.rows).toHaveLength(1);
    expect(p.duplicates).toBe(0);
  });

  it("match a first name whatever its case or spacing", () => {
    const p = plan([row({ "First name": "  emeka ", Phone: "08031234567" })], "234", {
      phones: [["8031234567", "Emeka"]],
    });
    expect(p.rows).toHaveLength(0);
    expect(p.duplicates).toBe(1);
  });

  /*
   * Every exported child, and many adults, has no email or phone — so there
   * was no key at all and re-importing an export doubled all of them.
   */
  it("with no contact, are matched on name and date of birth", () => {
    const p = planMemberImport(
      parseCsv(
        toCsv([
          [...MEMBER_CSV_HEADERS],
          row({ "First name": "Tobi", "Last name": "Obi", "Date of birth": "2015-06-01" }),
          row({ "First name": "Tobi", "Last name": "Obi", "Date of birth": "2017-01-09" }),
        ]),
      ),
      {
        dial: "234",
        existingEmails: new Set(),
        existingPhones: new Map(),
        existingPeople: new Set([personKey("tobi", "OBI", "2015-06-01", null)!]),
        maxRows: 5000,
      },
    );
    // The first is on file already; the second is a different Tobi Obi.
    expect(p.rows.map((r) => r.values.dateOfBirth)).toEqual(["2017-01-09"]);
    expect(p.duplicates).toBe(1);
    expect(p.errors.join(" | ")).toMatch(/Row 2: Tobi is already on the register \(same name and date of birth\)/);
  });

  it("with no contact, a child is matched on name and guardian", () => {
    const p = plan([
      row({ "First name": "Tobi", "Last name": "Obi", Child: "Yes", Guardian: "Ada Obi" }),
      row({ "First name": "Tobi", "Last name": "Obi", Child: "Yes", Guardian: "Ada  obi" }),
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.duplicates).toBe(1);
  });

  it("never calls two people one on a name alone", () => {
    const p = plan([
      row({ "First name": "John", "Last name": "Smith" }),
      row({ "First name": "John", "Last name": "Smith" }),
    ]);
    expect(p.rows).toHaveLength(2);
    expect(personKey("John", "Smith", null, null)).toBeNull();
  });

  it("never treat a number too short for the country as a phone to match on", () => {
    const p = plan([row({ "First name": "Emeka", Phone: "8031234" })], "234", {
      phones: [["8031234567", "Emeka"]],
    });
    expect(p.rows).toHaveLength(1);
  });

  it("are skipped when the same person appears twice in one file", () => {
    const p = plan([
      row({ "First name": "Ada", Phone: "08031234567" }),
      row({ "First name": "Ada", Phone: "+2348031234567" }),
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.duplicates).toBe(1);
  });
});

describe("dates that do not exist", () => {
  it("are left blank with a row number, and the row is kept", () => {
    const p = plan([
      row({ "First name": "Ada", "Date of birth": "1990-02-29", "Date joined": "2026-02-30" }),
    ]);
    expect(p.rows).toHaveLength(1);
    // Not moved to the 28th: a birthday on a day that is nobody's is named
    // and left blank, the same as any other date that does not exist.
    expect(p.rows[0].values.dateOfBirth).toBeNull();
    expect(p.errors.join(" | ")).toMatch(/Row 2: date of birth "1990-02-29"/);
    expect(p.rows[0].values.joinedAt).toBeNull();
    expect(p.errors.join("\n")).toMatch(/Row 2: date joined "2026-02-30" is not a real date/);
  });

  it("normalizeDate refuses an impossible day and keeps a real one", () => {
    expect(normalizeDate("2023-09-31")).toBeNull();
    expect(normalizeDate("2026-02-30")).toBeNull();
    expect(normalizeDate("2024/02/29")).toBe("2024-02-29");
    expect(normalizeDate("0000-01-01")).toBeNull();
  });
});

describe("email addresses", () => {
  /*
   * The old regex took "com1" as a top-level domain, so the address was
   * stored and every email to it was later refused by the mailer.
   */
  it("that no email could reach are left blank with a row number, and the row is kept", () => {
    const p = plan([row({ "First name": "Ephraim", Email: "ephraim@gmail.com1", Phone: "08031234567" })]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].values.email).toBeNull();
    expect(p.errors.join("\n")).toMatch(/Row 2: email "ephraim@gmail.com1" is not an address we can send to/);
  });

  it("are stored as the mailer will send to them", () => {
    const p = plan([row({ "First name": "Ada", Email: "Ada@Example.com." })]);
    expect(p.rows[0].values.email).toBe("ada@example.com");
    expect(p.errors).toEqual([]);
  });

  it("still find a member stored before the stricter rule, in either form", () => {
    const p = plan(
      [
        row({ "First name": "Ada", Email: "ada@example.com." }),
        row({ "First name": "Bola", Email: "bola@gmail.com1" }),
      ],
      "234",
      // As the route builds them: stored, trimmed and lower-cased.
      { emails: ["ada@example.com.", "bola@gmail.com1"] },
    );
    expect(p.rows).toHaveLength(0);
    expect(p.duplicates).toBe(2);
  });

  it("do not make a placeholder like \"nil\" anybody's address", () => {
    // What a spreadsheet puts in an empty email column. Read as a duplicate
    // key, every row after the first one saying "nil" was skipped.
    const p = plan([
      row({ "First name": "Ada", Email: "nil", Phone: "08031234567" }),
      row({ "First name": "Bola", Email: "nil", Phone: "08031234568" }),
      row({ "First name": "Chi", Email: "N/A", Phone: "08031234569" }),
      row({ "First name": "Dayo", Email: "n/a", Phone: "08031234570" }),
    ]);
    expect(p.rows).toHaveLength(4);
    expect(p.duplicates).toBe(0);
    expect(p.rows.every((r) => r.values.email === null)).toBe(true);
  });
});
