/**
 * A calendar file for one appointment (RFC 5545).
 *
 * Pure and client-safe. Emails attach it, and the booking and manage pages
 * build the same file in the browser from what they already show, so no URL
 * carrying the manage token ever has to serve it.
 *
 * The description is the location and nothing else. What the appointment is
 * ABOUT never goes into a calendar file: calendars sync to phones, laptops
 * and shared family accounts.
 */

export type IcsMethod = "PUBLISH" | "REQUEST" | "CANCEL";

export type IcsInput = {
  uid: string;
  /** Bumped on every move, so a calendar replaces the event rather than adding one. */
  sequence: number;
  startsAt: Date | string;
  endsAt: Date | string;
  summary: string;
  location?: string | null;
  description?: string | null;
  method: IcsMethod;
  /** DTSTAMP. Defaults to now. */
  now?: Date;
};

/** 2026-11-03T09:30:00.000Z -> 20261103T093000Z */
function utcStamp(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Backslash, semicolon, comma and newlines, as TEXT values require. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Fold a content line at 75 octets, continuation lines starting with one
 * space. Counted in UTF-8 bytes, never splitting a character, because a name
 * like "Adébáyọ̀" is longer in octets than in letters.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n");
}

export function buildIcs(input: IcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FlockInsight//Pastoral appointments//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${Math.max(0, Math.floor(input.sequence))}`,
    `DTSTAMP:${utcStamp(input.now ?? new Date())}`,
    `DTSTART:${utcStamp(input.startsAt)}`,
    `DTEND:${utcStamp(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  lines.push(`STATUS:${input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** The uid every message about one appointment shares. */
export function icsUid(appointmentId: string): string {
  return `${appointmentId}@flockinsight.com`;
}
