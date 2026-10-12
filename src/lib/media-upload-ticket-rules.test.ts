import { describe, expect, it } from "vitest";
import {
  MAX_OPEN_TICKETS,
  uploadTicketVerdict,
} from "@/lib/media-upload-ticket-rules";

const MB = 1024 * 1024;

describe("handing out a direct-upload ticket", () => {
  it("says yes when the file fits beside what is stored and what is in flight", () => {
    expect(
      uploadTicketVerdict({ used: 50 * MB, limit: 200 * MB, reservedBytes: 50 * MB, openTickets: 1, bytes: 90 * MB }),
    ).toEqual({ ok: true });
  });

  it("counts uploads already in flight, so two tabs cannot both take the last 100 MB", () => {
    // The first 90 MB ticket is open; the second sees it.
    const v = uploadTicketVerdict({
      used: 100 * MB,
      limit: 200 * MB,
      reservedBytes: 90 * MB,
      openTickets: 1,
      bytes: 90 * MB,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(413);
      expect(v.code).toBe("quota");
      expect(v.error).toMatch(/already in progress/);
    }
  });

  it("limits how many may be open at once, whatever size they claim", () => {
    // The hole: {bytes: 1} reserves nothing, and each ticket is good for a
    // 100 MB asset. Without a cap, the reservation alone bounds nothing.
    const v = uploadTicketVerdict({
      used: 0,
      limit: 200 * MB,
      reservedBytes: MAX_OPEN_TICKETS,
      openTickets: MAX_OPEN_TICKETS,
      bytes: 1,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(429);
      expect(v.code).toBe("busy");
    }
    expect(
      uploadTicketVerdict({ used: 0, limit: 200 * MB, reservedBytes: 0, openTickets: MAX_OPEN_TICKETS - 1, bytes: 1 }).ok,
    ).toBe(true);
  });

  it("refuses a file that does not fit even with nothing in flight, in the old words", () => {
    const v = uploadTicketVerdict({ used: 199 * MB, limit: 200 * MB, reservedBytes: 0, openTickets: 0, bytes: 2 * MB });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/^Not enough storage — this file is .* and you have .* free\./);
  });

  it("lets a file fill the quota exactly", () => {
    expect(
      uploadTicketVerdict({ used: 100 * MB, limit: 200 * MB, reservedBytes: 0, openTickets: 0, bytes: 100 * MB }).ok,
    ).toBe(true);
  });
});
