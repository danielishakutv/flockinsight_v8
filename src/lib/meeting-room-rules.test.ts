import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_SIGNAL_TYPES,
  insideBookedSlot,
  SIGNAL_TYPES,
} from "@/lib/meetings-shared";

/**
 * Rules about who may do what to a room, each written after it went wrong in
 * a real meeting.
 */

describe("what a browser may relay through /sync", () => {
  it("never includes `bye`", () => {
    /*
     * A `bye` names who is leaving, and every client believes the name. Posted
     * by a guest with the preacher's peer id — which every roster carries —
     * it made every phone in the room drop the preacher's audio. Only the
     * server says goodbye on somebody's behalf.
     */
    expect(CLIENT_SIGNAL_TYPES).not.toContain("bye");
  });

  it("never includes anything that changes the room", () => {
    // These go through /action, where the caller's role is checked.
    for (const type of ["control", "stage", "roster", "state", "chat", "recording"] as const) {
      expect(CLIENT_SIGNAL_TYPES).not.toContain(type);
    }
  });

  it("still carries everything two browsers need to connect", () => {
    for (const type of ["offer", "answer", "ice", "renegotiate", "pause", "reaction"] as const) {
      expect(CLIENT_SIGNAL_TYPES).toContain(type);
    }
  });

  it("only names types the room actually has", () => {
    for (const type of CLIENT_SIGNAL_TYPES) expect(SIGNAL_TYPES).toContain(type);
  });
});

describe("insideBookedSlot", () => {
  const ten = new Date("2026-10-25T09:00:00Z"); // 10:00 in Lagos
  const sunday = { scheduledFor: ten, durationMin: 90 };
  const at = (iso: string) => new Date(iso).getTime();

  it("protects a room opened early to test a camera", () => {
    /*
     * The bug: the host opened the room at 9:30, closed the tab at 9:35, and
     * the housekeeping cron ended the meeting at 9:40. At 9:58 everybody,
     * the host included, was told it had ended.
     */
    expect(insideBookedSlot(sunday, at("2026-10-25T08:40:00Z"))).toBe(true);
  });

  it("protects it while the congregation is late", () => {
    expect(insideBookedSlot(sunday, at("2026-10-25T09:10:00Z"))).toBe(true);
  });

  it("lets it go once the booked time is over", () => {
    expect(insideBookedSlot(sunday, at("2026-10-25T10:30:00Z"))).toBe(false);
    expect(insideBookedSlot(sunday, at("2026-10-25T11:00:00Z"))).toBe(false);
  });

  it("protects nothing for a meeting with no scheduled time", () => {
    expect(insideBookedSlot({ scheduledFor: null, durationMin: 60 }, at("2026-10-25T09:00:00Z"))).toBe(
      false,
    );
  });
});

/*
 * Read from source rather than imported, like meeting-timing.test.ts: the
 * actions are server-only and need a database, and what has to stay true is
 * the shape of one call.
 */
const SRC = join(import.meta.dirname, "..");

/** The body of one exported async function in a source file. */
function functionBody(relativePath: string, name: string): string {
  const src = readFileSync(join(SRC, relativePath), "utf8");
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${relativePath} no longer declares ${name}`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("'Run this meeting again'", () => {
  const body = functionBody("app/(app)/meetings/actions.ts", "duplicateMeeting");

  it("chooses the copy's transport the way a new meeting does", () => {
    /*
     * Without it every copy fell to the column default, "mesh": a re-run of a
     * 50-person prayer meeting had every phone uploading one stream per
     * person, and could not be recorded.
     */
    expect(body).toMatch(/transport:\s*chooseTransport\(/);
  });

  it("holds the copy to the plan's room ceiling", () => {
    expect(body).toContain("meetingLimitFor(");
  });
});
