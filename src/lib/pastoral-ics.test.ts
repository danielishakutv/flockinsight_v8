import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldLine, icsUid } from "@/lib/pastoral-ics";

const base = {
  uid: icsUid("8c0f9d2e-0000-4000-8000-000000000001"),
  sequence: 2,
  startsAt: "2026-11-03T09:30:00.000Z",
  endsAt: "2026-11-03T10:30:00.000Z",
  summary: "Counselling · Pastor Ade",
  location: "At the church",
  description: "At the church",
  method: "REQUEST" as const,
  now: new Date("2026-11-01T12:00:00.000Z"),
};

describe("the calendar file", () => {
  it("uses CRLF line ends and UTC times", () => {
    const ics = buildIcs(base);
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(ics).toContain("DTSTART:20261103T093000Z");
    expect(ics).toContain("DTEND:20261103T103000Z");
    expect(ics).toContain("DTSTAMP:20261101T120000Z");
  });

  it("bumps SEQUENCE with every move, so a calendar replaces the event", () => {
    expect(buildIcs(base)).toContain("SEQUENCE:2");
    expect(buildIcs(base)).toContain(`UID:${base.uid}`);
  });

  it("says CANCEL and CANCELLED for a cancellation", () => {
    const ics = buildIcs({ ...base, method: "CANCEL" });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("escapes backslash, semicolon, comma and newline", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
    expect(buildIcs({ ...base, location: "12 Allen Ave, Ikeja; gate 2" })).toContain(
      "LOCATION:12 Allen Ave\\, Ikeja\\; gate 2",
    );
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const long = `SUMMARY:${"Adébáyọ̀ ".repeat(20)}`;
    const folded = foldLine(long);
    const enc = new TextEncoder();
    for (const line of folded.split("\r\n")) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("never contains anything but what it was given: no topic can leak in", () => {
    const ics = buildIcs(base);
    expect(ics).not.toMatch(/marriage|grief|topic/i);
  });
});
