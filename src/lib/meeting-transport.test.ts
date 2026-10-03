import { describe, expect, it } from "vitest";
import {
  canRepeatMeetings,
  chooseTransport,
  MESH_CEILING,
  meetingLimitFor,
} from "@/lib/meetings-shared";

/**
 * Which transport a room uses, and how big a room a plan allows.
 *
 * The rule that matters most is that a meeting's transport is decided ONCE and
 * everyone in the room shares it. A mesh peer and an SFU peer cannot see each
 * other at all, so a room that changed its mind halfway through would split a
 * congregation in two at the moment it mattered most.
 */

describe("chooseTransport", () => {
  it("keeps a small room peer-to-peer", () => {
    // No server in the media path, lowest latency, costs nothing to run.
    expect(chooseTransport({ maxParticipants: 6, sfuAvailable: true })).toBe("mesh");
  });

  it("sends a room bigger than the mesh ceiling to the SFU", () => {
    expect(
      chooseTransport({ maxParticipants: MESH_CEILING + 1, sfuAvailable: true }),
    ).toBe("sfu");
  });

  it("falls back to mesh when the SFU is not configured", () => {
    // A smaller meeting that works beats a larger one that cannot start. This
    // is what keeps the module usable on a server with no Cloudflare account.
    expect(chooseTransport({ maxParticipants: 200, sfuAvailable: false })).toBe("mesh");
  });
});

describe("meetingLimitFor", () => {
  it("gives each plan its own ceiling", () => {
    expect(meetingLimitFor("starter")).toBe(12);
    expect(meetingLimitFor("growth")).toBe(50);
    expect(meetingLimitFor("pro")).toBe(200);
  });

  it("treats enterprise as unlimited", () => {
    expect(meetingLimitFor("enterprise")).toBeNull();
  });

  it("falls back to the smallest ceiling for a plan it does not know", () => {
    // A plan id we do not recognise must not accidentally mean "unlimited" —
    // relayed media costs real money per gigabyte.
    expect(meetingLimitFor("something-new")).toBe(12);
  });
});

describe("canRepeatMeetings", () => {
  it("is a paid upgrade above the plan that merely has meetings", () => {
    // Growth can hold a meeting; Pro can stop having to create it. That gap is
    // the product decision, so it is pinned rather than left to a config file.
    expect(canRepeatMeetings("pro")).toBe(true);
    expect(canRepeatMeetings("enterprise")).toBe(true);
    expect(canRepeatMeetings("growth")).toBe(false);
    expect(canRepeatMeetings("starter")).toBe(false);
  });

  it("refuses a plan it does not recognise, and a missing one", () => {
    /*
     * Same rule as every other limit here: an unknown plan id must never
     * accidentally mean "everything". A typo in a plan column is a bug, and the
     * safe reading of a bug is the smallest allowance.
     */
    expect(canRepeatMeetings("something-new")).toBe(false);
    expect(canRepeatMeetings(null)).toBe(false);
    expect(canRepeatMeetings(undefined)).toBe(false);
    expect(canRepeatMeetings("")).toBe(false);
  });
});
