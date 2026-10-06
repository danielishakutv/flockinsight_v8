import { describe, expect, it } from "vitest";
import {
  blocksTheSlot,
  durationLabel,
  feeFor,
  findClashes,
  overlaps,
  validateBooking,
  withBuffer,
  type ClashCandidate,
} from "@/lib/facility-shared";

/**
 * The clash check is the module.
 *
 * Everything else a facility register does is a list; this is the part that
 * stops a church putting a wedding and a youth rehearsal in the same hall at
 * the same time, and it is worth testing like it matters.
 */

const at = (iso: string) => new Date(iso);
const period = (s: string, e: string) => ({ startsAt: at(s), endsAt: at(e) });

const booking = (
  id: string,
  s: string,
  e: string,
  label = "Something",
): ClashCandidate => ({ id, label, sort: "booking", startsAt: at(s), endsAt: at(e) });

const closure = (id: string, s: string, e: string, label = "Repainting"): ClashCandidate => ({
  id,
  label,
  sort: "closure",
  startsAt: at(s),
  endsAt: at(e),
});

describe("overlapping", () => {
  it("is true when one sits inside the other", () => {
    expect(
      overlaps(period("2026-11-07T10:00Z", "2026-11-07T14:00Z"), period("2026-11-07T11:00Z", "2026-11-07T12:00Z")),
    ).toBe(true);
  });

  it("is true when they cross at either end", () => {
    expect(
      overlaps(period("2026-11-07T10:00Z", "2026-11-07T12:00Z"), period("2026-11-07T11:00Z", "2026-11-07T13:00Z")),
    ).toBe(true);
    expect(
      overlaps(period("2026-11-07T11:00Z", "2026-11-07T13:00Z"), period("2026-11-07T10:00Z", "2026-11-07T12:00Z")),
    ).toBe(true);
  });

  it("is FALSE when one ends exactly as the other starts", () => {
    /*
     * The decision that makes the module usable. A church that cannot book
     * 10–12 and 12–2 on the same morning goes back to the paper diary.
     */
    expect(
      overlaps(period("2026-11-07T10:00Z", "2026-11-07T12:00Z"), period("2026-11-07T12:00Z", "2026-11-07T14:00Z")),
    ).toBe(false);
  });

  it("is false when they are nowhere near each other", () => {
    expect(
      overlaps(period("2026-11-07T10:00Z", "2026-11-07T12:00Z"), period("2026-11-08T10:00Z", "2026-11-08T12:00Z")),
    ).toBe(false);
  });

  it("does not care which order it is asked in", () => {
    const a = period("2026-11-07T10:00Z", "2026-11-07T12:00Z");
    const b = period("2026-11-07T11:00Z", "2026-11-07T13:00Z");
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it("reads an ISO string the same as a Date", () => {
    expect(
      overlaps(
        { startsAt: "2026-11-07T10:00:00Z", endsAt: "2026-11-07T12:00:00Z" },
        period("2026-11-07T11:00Z", "2026-11-07T13:00Z"),
      ),
    ).toBe(true);
  });
});

describe("the set-up buffer", () => {
  it("widens a period on both sides", () => {
    const w = withBuffer(period("2026-11-07T10:00Z", "2026-11-07T12:00Z"), 30);
    expect(new Date(w.startsAt).toISOString()).toBe("2026-11-07T09:30:00.000Z");
    expect(new Date(w.endsAt).toISOString()).toBe("2026-11-07T12:30:00.000Z");
  });

  it("treats a negative buffer as none, rather than narrowing the window", () => {
    const w = withBuffer(period("2026-11-07T10:00Z", "2026-11-07T12:00Z"), -60);
    expect(new Date(w.startsAt).toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("keeps back-to-back bookings apart once a facility needs clearing", () => {
    const existing = [booking("a", "2026-11-07T10:00Z", "2026-11-07T12:00Z", "Wedding")];
    const straightAfter = period("2026-11-07T12:00Z", "2026-11-07T14:00Z");

    expect(findClashes(straightAfter, existing)).toHaveLength(0);
    expect(findClashes(straightAfter, existing, { bufferMinutes: 60 })).toHaveLength(1);
  });

  it("explains that it is the buffer, not the booking, that is in the way", () => {
    const existing = [booking("a", "2026-11-07T10:00Z", "2026-11-07T12:00Z", "Wedding")];
    const [clash] = findClashes(period("2026-11-07T12:00Z", "2026-11-07T14:00Z"), existing, {
      bufferMinutes: 60,
    });
    expect(clash.reason).toMatch(/set up and clear away/);
    expect(clash.reason).toContain("Wedding");
  });
});

describe("finding what is in the way", () => {
  const existing = [
    booking("a", "2026-11-07T10:00Z", "2026-11-07T12:00Z", "Wedding"),
    booking("b", "2026-11-08T10:00Z", "2026-11-08T12:00Z", "Youth rehearsal"),
    closure("c", "2026-11-09T00:00Z", "2026-11-10T00:00Z", "Repainting"),
  ];

  it("finds nothing when the slot is free", () => {
    expect(findClashes(period("2026-11-07T14:00Z", "2026-11-07T16:00Z"), existing)).toEqual([]);
  });

  it("names the booking in the way", () => {
    const [clash] = findClashes(period("2026-11-07T11:00Z", "2026-11-07T13:00Z"), existing);
    expect(clash.with.id).toBe("a");
    expect(clash.reason).toBe("Wedding is already booked then.");
  });

  it("reports a closure differently from a booking", () => {
    const [clash] = findClashes(period("2026-11-09T10:00Z", "2026-11-09T12:00Z"), existing);
    expect(clash.with.sort).toBe("closure");
    expect(clash.reason).toBe("It is closed then — Repainting.");
  });

  it("finds every clash, not just the first", () => {
    const all = findClashes(period("2026-11-07T11:00Z", "2026-11-08T11:00Z"), existing);
    expect(all.map((c) => c.with.id).sort()).toEqual(["a", "b"]);
  });

  it("lets a booking be edited without clashing with itself", () => {
    const sameSlot = period("2026-11-07T10:00Z", "2026-11-07T12:00Z");
    expect(findClashes(sameSlot, existing)).toHaveLength(1);
    expect(findClashes(sameSlot, existing, { ignoreId: "a" })).toHaveLength(0);
  });

  it("does not apply the buffer to a closure — shut is shut", () => {
    // Right up to the closure, with a big buffer. The closure does not grow.
    const upToIt = period("2026-11-08T20:00Z", "2026-11-09T00:00Z");
    expect(findClashes(upToIt, existing, { bufferMinutes: 120 })).toHaveLength(0);
  });
});

describe("which bookings hold the slot", () => {
  it("is approved, and only approved", () => {
    expect(blocksTheSlot("approved")).toBe(true);
    for (const s of ["requested", "declined", "cancelled", "nonsense"]) {
      expect(blocksTheSlot(s), s).toBe(false);
    }
  });
});

describe("validating a booking", () => {
  const ok = { facilityId: "f1", title: "Wedding", startsAt: "2026-11-07T10:00Z", endsAt: "2026-11-07T14:00Z" };

  it("accepts a sensible one", () => {
    const r = validateBooking(ok);
    expect(r.ok).toBe(true);
  });

  it("needs a name", () => {
    expect(validateBooking({ ...ok, title: " " }).ok).toBe(false);
    expect(validateBooking({ ...ok, title: "x" }).ok).toBe(false);
  });

  it("needs something to book", () => {
    expect(validateBooking({ ...ok, facilityId: "" }).ok).toBe(false);
  });

  it("refuses an end before the start, and a zero-length booking", () => {
    expect(validateBooking({ ...ok, endsAt: "2026-11-07T09:00Z" }).ok).toBe(false);
    expect(validateBooking({ ...ok, endsAt: ok.startsAt }).ok).toBe(false);
  });

  it("refuses a date that is not a date", () => {
    expect(validateBooking({ ...ok, startsAt: "next Tuesday" }).ok).toBe(false);
  });

  it("refuses a booking longer than a month, which is a typo", () => {
    const r = validateBooking({ ...ok, endsAt: "2027-06-07T14:00Z" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/close it for maintenance/);
  });

  it("ALLOWS a booking in the past, because churches write last Saturday down on Monday", () => {
    expect(
      validateBooking({ ...ok, startsAt: "2020-01-01T10:00Z", endsAt: "2020-01-01T12:00Z" }).ok,
    ).toBe(true);
  });

  it("refuses more people than the room holds", () => {
    const r = validateBooking({ ...ok, expectedAttendance: 500 }, { capacity: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("200");
  });

  it("says nothing about numbers when the capacity is unknown", () => {
    expect(validateBooking({ ...ok, expectedAttendance: 5000 }, { capacity: null }).ok).toBe(true);
  });

  it("trims the title it returns", () => {
    const r = validateBooking({ ...ok, title: "  Wedding  " });
    expect(r.ok && r.value.title).toBe("Wedding");
  });
});

describe("what it costs", () => {
  const twoHours = period("2026-11-07T10:00Z", "2026-11-07T12:00Z");

  it("is nothing when the facility is not hired out", () => {
    expect(feeFor("free", 5000, twoHours)).toBeNull();
    expect(feeFor("hour", null, twoHours)).toBeNull();
    expect(feeFor("hour", 0, twoHours)).toBeNull();
  });

  it("charges a flat fee per booking", () => {
    expect(feeFor("session", 50_000, twoHours)).toBe(50_000);
  });

  it("charges by the hour", () => {
    expect(feeFor("hour", 5_000, twoHours)).toBe(10_000);
  });

  it("rounds UP to the next hour, the way every hall does", () => {
    const over = period("2026-11-07T10:00Z", "2026-11-07T12:10Z");
    expect(feeFor("hour", 5_000, over)).toBe(15_000);
  });

  it("charges at least one unit for a very short booking", () => {
    const tenMinutes = period("2026-11-07T10:00Z", "2026-11-07T10:10Z");
    expect(feeFor("hour", 5_000, tenMinutes)).toBe(5_000);
    expect(feeFor("day", 40_000, tenMinutes)).toBe(40_000);
  });

  it("charges by the day", () => {
    const threeDays = period("2026-11-07T10:00Z", "2026-11-10T10:00Z");
    expect(feeFor("day", 40_000, threeDays)).toBe(120_000);
  });
});

describe("how long it runs, in words", () => {
  it("reads naturally at every scale", () => {
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-07T10:45Z"))).toBe("45 minutes");
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-07T11:00Z"))).toBe("1 hour");
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-07T12:00Z"))).toBe("2 hours");
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-07T12:30Z"))).toBe("2.5 hours");
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-08T10:00Z"))).toBe("1 day");
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-10T10:00Z"))).toBe("3 days");
  });

  it("says one minute, not 1 minutes", () => {
    expect(durationLabel(period("2026-11-07T10:00Z", "2026-11-07T10:01Z"))).toBe("1 minute");
  });
});
