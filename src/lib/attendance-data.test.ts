import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CSV_HEADERS,
  ATTENDANCE_CSV_SAMPLE,
  headerToAttendanceField,
  oneOffSessionKey,
  resolveImportedBands,
} from "@/lib/attendance-data";

/**
 * The attendance spreadsheet, out and back in.
 *
 * A church that counts youths and seniors had them in Total and in no column,
 * so exporting, fixing a typo and importing the file back rewrote every
 * session's total of 140 as 100. And every session without a service was
 * inserted again on the way back in.
 */

describe("the columns", () => {
  it("carries youths and seniors, and the import reads them back", () => {
    for (const [header, key] of [
      ["Youth Male", "youthMale"],
      ["Youth Female", "youthFemale"],
      ["Senior Male", "seniorMale"],
      ["Senior Female", "seniorFemale"],
    ] as const) {
      expect(ATTENDANCE_CSV_HEADERS).toContain(header);
      expect(headerToAttendanceField(header)).toBe(key);
    }
  });

  it("keeps the template row the same width as the header", () => {
    expect(ATTENDANCE_CSV_SAMPLE).toHaveLength(ATTENDANCE_CSV_HEADERS.length);
  });

  it("maps every header it writes to a field", () => {
    // A header the import cannot read is a column that silently goes missing.
    for (const h of ATTENDANCE_CSV_HEADERS) {
      expect(headerToAttendanceField(h), h).not.toBeNull();
    }
  });
});

describe("resolveImportedBands", () => {
  const none = { youthMale: null, youthFemale: null, seniorMale: null, seniorFemale: null };
  const stored = { youthMale: 15, youthFemale: 15, seniorMale: 5, seniorFemale: 5 };

  it("counts the bands a file states in the total", () => {
    const r = resolveImportedBands({
      base: 100,
      fileTotal: 140,
      bands: { youthMale: 15, youthFemale: 15, seniorMale: 5, seniorFemale: 5 },
      stored: null,
    });
    expect(r.total).toBe(140);
    expect(r.bands).toEqual(stored);
  });

  it("keeps the stored figures when an older file has no such columns", () => {
    // The 140 → 100 bug: an export from before these columns existed, brought
    // back. Zeros would wipe the youth counts; dropping them from the total
    // is the bug itself.
    const r = resolveImportedBands({ base: 100, fileTotal: 140, bands: none, stored });
    expect(r.bands).toEqual(stored);
    expect(r.total).toBe(140);
  });

  it("takes a stated zero as zero", () => {
    const r = resolveImportedBands({
      base: 100,
      fileTotal: 0,
      bands: { youthMale: 0, youthFemale: 0, seniorMale: 0, seniorFemale: 0 },
      stored,
    });
    expect(r.bands).toEqual({ youthMale: 0, youthFemale: 0, seniorMale: 0, seniorFemale: 0 });
    expect(r.total).toBe(100);
  });

  it("gives a new session zero for a band the file does not mention", () => {
    const r = resolveImportedBands({ base: 80, fileTotal: 0, bands: none, stored: null });
    expect(r.bands).toEqual({ youthMale: 0, youthFemale: 0, seniorMale: 0, seniorFemale: 0 });
    expect(r.total).toBe(80);
  });

  it("falls back to the Total column when the file has no split at all", () => {
    expect(resolveImportedBands({ base: 0, fileTotal: 250, bands: none, stored: null }).total).toBe(
      250,
    );
  });
});

describe("oneOffSessionKey", () => {
  it("matches an exported one-off with the session it came from", () => {
    expect(oneOffSessionKey("2026-03-01", " Crusade Night ")).toBe(
      oneOffSessionKey("2026-03-01", "crusade night"),
    );
  });

  it("reads a session with no name as the 'Event' the export wrote", () => {
    expect(oneOffSessionKey("2026-03-01", null)).toBe(oneOffSessionKey("2026-03-01", "Event"));
  });

  it("keeps different days apart", () => {
    expect(oneOffSessionKey("2026-03-01", "Vigil")).not.toBe(
      oneOffSessionKey("2026-03-08", "Vigil"),
    );
  });
});
