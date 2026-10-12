/**
 * Facilities against a real database. Run with `pnpm test:db`.
 *
 * One invariant is worth all of this: an approved booking never overlaps
 * another approved booking on the same facility, nor a closure. A
 * double-booked wedding is not a bug you get to apologise for.
 *
 * Creates its own church and removes exactly what it created.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, facility, facilityBooking, facilityClosure } from "@/db/schema";
import {
  calendarFor,
  clashesFor,
  isBookingOverlapViolation,
  listBookings,
  lockFacilityForBooking,
  pendingCount,
} from "@/lib/facilities";

const stamp = Date.now();
const churchId = `fac-check-${stamp}`;
let hallId = "";
let busId = "";
const bookingIds: string[] = [];
const closureIds: string[] = [];

const at = (iso: string) => new Date(iso);

async function book(
  facilityId: string,
  startsAt: string,
  endsAt: string,
  status: "requested" | "approved" | "declined" | "cancelled",
  title = "Booking",
) {
  const [row] = await db
    .insert(facilityBooking)
    .values({
      churchId,
      facilityId,
      title,
      startsAt: at(startsAt),
      endsAt: at(endsAt),
      status,
    })
    .returning({ id: facilityBooking.id });
  bookingIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  await db
    .insert(church)
    .values({ id: churchId, name: `Facility Check ${stamp}`, slug: churchId, currency: "NGN" })
    .onConflictDoNothing();

  const [hall] = await db
    .insert(facility)
    .values({
      churchId,
      name: "Main Auditorium",
      kind: "hall",
      capacity: 500,
      bufferMinutes: 60,
      rate: "hour",
      hireFee: 5000,
    })
    .returning({ id: facility.id });
  hallId = hall.id;

  const [bus] = await db
    .insert(facility)
    .values({ churchId, name: "Church Bus", kind: "vehicle", bufferMinutes: 0 })
    .returning({ id: facility.id });
  busId = bus.id;
});

afterAll(async () => {
  if (closureIds.length) await db.delete(facilityClosure).where(inArray(facilityClosure.id, closureIds));
  if (bookingIds.length) await db.delete(facilityBooking).where(inArray(facilityBooking.id, bookingIds));
  await db.delete(facility).where(eq(facility.churchId, churchId));
  await db.delete(church).where(eq(church.id, churchId));
});

describe("what holds a slot", () => {
  it("an approved booking does", async () => {
    await book(busId, "2026-12-05T10:00Z", "2026-12-05T12:00Z", "approved", "Outreach run");
    const clashes = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-05T11:00Z"),
      endsAt: at("2026-12-05T13:00Z"),
      bufferMinutes: 0,
    });
    expect(clashes).toHaveLength(1);
    expect(clashes[0].with.label).toBe("Outreach run");
  });

  it("a mere REQUEST does not — two people may ask for the same Saturday", async () => {
    await book(busId, "2026-12-06T10:00Z", "2026-12-06T12:00Z", "requested", "Maybe");
    const clashes = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-06T10:00Z"),
      endsAt: at("2026-12-06T12:00Z"),
      bufferMinutes: 0,
    });
    expect(clashes).toHaveLength(0);
  });

  it("a declined or cancelled booking holds nothing", async () => {
    await book(busId, "2026-12-07T10:00Z", "2026-12-07T12:00Z", "declined", "No");
    await book(busId, "2026-12-07T10:00Z", "2026-12-07T12:00Z", "cancelled", "Called off");
    const clashes = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-07T10:00Z"),
      endsAt: at("2026-12-07T12:00Z"),
      bufferMinutes: 0,
    });
    expect(clashes).toHaveLength(0);
  });
});

describe("the slot next door", () => {
  it("lets a booking start exactly when another ends", async () => {
    await book(busId, "2026-12-08T10:00Z", "2026-12-08T12:00Z", "approved", "Morning run");
    const clashes = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-08T12:00Z"),
      endsAt: at("2026-12-08T14:00Z"),
      bufferMinutes: 0,
    });
    expect(clashes).toHaveLength(0);
  });

  it("but not when the facility needs an hour to clear away", async () => {
    await book(hallId, "2026-12-08T10:00Z", "2026-12-08T12:00Z", "approved", "Wedding");
    const clashes = await clashesFor({
      churchId,
      facilityId: hallId,
      startsAt: at("2026-12-08T12:00Z"),
      endsAt: at("2026-12-08T14:00Z"),
      bufferMinutes: 60,
    });
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toMatch(/set up and clear away/);
  });
});

describe("one facility does not block another", () => {
  it("keeps the hall and the bus independent", async () => {
    await book(hallId, "2026-12-09T10:00Z", "2026-12-09T12:00Z", "approved", "Hall thing");
    const clashes = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-09T10:00Z"),
      endsAt: at("2026-12-09T12:00Z"),
      bufferMinutes: 0,
    });
    expect(clashes).toHaveLength(0);
  });
});

describe("closures", () => {
  it("block a booking, and say so differently from a clash", async () => {
    const [c] = await db
      .insert(facilityClosure)
      .values({
        churchId,
        facilityId: hallId,
        kind: "maintenance",
        reason: "Repainting",
        startsAt: at("2026-12-14T00:00Z"),
        endsAt: at("2026-12-17T00:00Z"),
        cost: 45000,
      })
      .returning({ id: facilityClosure.id });
    closureIds.push(c.id);

    const clashes = await clashesFor({
      churchId,
      facilityId: hallId,
      startsAt: at("2026-12-15T10:00Z"),
      endsAt: at("2026-12-15T12:00Z"),
      bufferMinutes: 60,
    });
    expect(clashes).toHaveLength(1);
    expect(clashes[0].with.sort).toBe("closure");
    expect(clashes[0].reason).toContain("Repainting");
  });

  it("are not widened by the buffer — shut is shut, not shut plus an hour", async () => {
    const clashes = await clashesFor({
      churchId,
      facilityId: hallId,
      startsAt: at("2026-12-13T20:00Z"),
      endsAt: at("2026-12-14T00:00Z"),
      bufferMinutes: 120,
    });
    expect(clashes).toHaveLength(0);
  });
});

describe("editing a booking", () => {
  it("does not clash with itself", async () => {
    const id = await book(busId, "2026-12-20T10:00Z", "2026-12-20T12:00Z", "approved", "Mine");
    const without = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-20T10:00Z"),
      endsAt: at("2026-12-20T12:00Z"),
      bufferMinutes: 0,
    });
    const with_ = await clashesFor({
      churchId,
      facilityId: busId,
      startsAt: at("2026-12-20T10:00Z"),
      endsAt: at("2026-12-20T12:00Z"),
      bufferMinutes: 0,
      ignoreBookingId: id,
    });
    expect(without).toHaveLength(1);
    expect(with_).toHaveLength(0);
  });
});

describe("tenancy", () => {
  it("never sees another church's bookings", async () => {
    const otherId = `fac-other-${stamp}`;
    await db
      .insert(church)
      .values({ id: otherId, name: "Other", slug: otherId, currency: "NGN" })
      .onConflictDoNothing();
    const [f] = await db
      .insert(facility)
      .values({ churchId: otherId, name: "Their hall" })
      .returning({ id: facility.id });
    await db.insert(facilityBooking).values({
      churchId: otherId,
      facilityId: f.id,
      title: "Theirs",
      startsAt: at("2026-12-25T10:00Z"),
      endsAt: at("2026-12-25T12:00Z"),
      status: "approved",
    });

    const mine = await listBookings(churchId);
    expect(mine.some((b) => b.title === "Theirs")).toBe(false);

    await db.delete(facilityBooking).where(eq(facilityBooking.churchId, otherId));
    await db.delete(facility).where(eq(facility.churchId, otherId));
    await db.delete(church).where(eq(church.id, otherId));
  });
});

describe("what the page reads", () => {
  it("counts only the requests waiting on somebody", async () => {
    const n = await pendingCount(churchId);
    const requested = (await listBookings(churchId)).filter((b) => b.status === "requested");
    expect(n).toBe(requested.length);
  });

  it("puts bookings and closures on one calendar, in time order", async () => {
    const entries = await calendarFor(
      churchId,
      at("2026-12-01T00:00Z"),
      at("2027-01-01T00:00Z"),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.kind === "closure")).toBe(true);

    const sorted = [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(entries.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });

  it("leaves declined and cancelled bookings off the calendar", async () => {
    const entries = await calendarFor(
      churchId,
      at("2026-12-07T00:00Z"),
      at("2026-12-08T00:00Z"),
    );
    // Both of the 7th's bookings were declined/cancelled.
    expect(entries.filter((e) => e.kind === "booking")).toHaveLength(0);
  });
});

describe("two managers approving one slot at the same moment", () => {
  /*
   * READ COMMITTED does not stop two "is it free? then take it" runs from both
   * succeeding (AGENTS.md). Each approval takes the facility's row lock first,
   * so the second WAITS — and then its clash check sees the first approval.
   * The two transactions are interleaved by hand over one contested hall, so
   * this fails without the lock rather than passing because they happened to
   * run one after the other.
   */
  it("lets exactly one through", async () => {
    const wedding = await book(hallId, "2027-03-06T10:00:00Z", "2027-03-06T14:00:00Z", "requested", "Wedding");
    const youth = await book(hallId, "2027-03-06T11:00:00Z", "2027-03-06T13:00:00Z", "requested", "Youth");

    let aHasLock!: () => void;
    const aLocked = new Promise<void>((r) => (aHasLock = r));
    let letAGo!: () => void;
    const aMayFinish = new Promise<void>((r) => (letAGo = r));

    const approve = (id: string, startsAt: string, endsAt: string, hold?: () => Promise<void>) =>
      db.transaction(async (tx) => {
        expect(await lockFacilityForBooking(tx, churchId, hallId)).toBe(true);
        if (hold) await hold();
        const clashes = await clashesFor(
          {
            churchId,
            facilityId: hallId,
            startsAt: at(startsAt),
            endsAt: at(endsAt),
            ignoreBookingId: id,
            bufferMinutes: 60,
          },
          tx,
        );
        if (clashes.length > 0) return false;
        const rows = await tx
          .update(facilityBooking)
          .set({ status: "approved" })
          .where(and(eq(facilityBooking.id, id), eq(facilityBooking.status, "requested")))
          .returning({ id: facilityBooking.id });
        return rows.length === 1;
      });

    const a = approve(wedding, "2027-03-06T10:00:00Z", "2027-03-06T14:00:00Z", async () => {
      aHasLock();
      await aMayFinish;
    });
    await aLocked;
    // B starts while A holds the lock, and must block on it.
    const b = approve(youth, "2027-03-06T11:00:00Z", "2027-03-06T13:00:00Z");
    await new Promise((r) => setTimeout(r, 300));
    letAGo();

    const [okA, okB] = await Promise.all([a, b]);
    expect(okA).toBe(true);
    expect(okB).toBe(false);

    const rows = await db
      .select({ id: facilityBooking.id, status: facilityBooking.status })
      .from(facilityBooking)
      .where(inArray(facilityBooking.id, [wedding, youth]));
    expect(rows.filter((r) => r.status === "approved").map((r) => r.id)).toEqual([wedding]);
  });

  it("will not lock a facility from another church", async () => {
    const other = await db.transaction((tx) => lockFacilityForBooking(tx, "zzcheck-not-this-church", hallId));
    expect(other).toBe(false);
  });
});

describe("the database's own rule, for a write path that forgets the lock", () => {
  /*
   * The row lock above is the application's half. This is the floor under it:
   * the `facility_booking_no_overlap` exclusion constraint refuses a second
   * APPROVED booking whose interval overlaps another on the same facility,
   * whoever writes it — an import, a superadmin tool, a cron — with SQLSTATE
   * 23P01, which `isBookingOverlapViolation` recognises.
   */
  it("refuses two overlapping approved bookings written directly", async () => {
    await book(busId, "2027-04-10T10:00Z", "2027-04-10T12:00Z", "approved", "First");
    const err = await book(busId, "2027-04-10T11:00Z", "2027-04-10T13:00Z", "approved", "Second").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(isBookingOverlapViolation(err)).toBe(true);
  });

  it("allows one to start exactly when the other ends", async () => {
    await book(busId, "2027-04-11T10:00Z", "2027-04-11T12:00Z", "approved", "Morning");
    await expect(
      book(busId, "2027-04-11T12:00Z", "2027-04-11T14:00Z", "approved", "Afternoon"),
    ).resolves.toBeTruthy();
  });

  it("does not refuse a REQUEST over an approved booking — that is what the review is for", async () => {
    await book(busId, "2027-04-12T10:00Z", "2027-04-12T12:00Z", "approved", "Held");
    await expect(
      book(busId, "2027-04-12T11:00Z", "2027-04-12T13:00Z", "requested", "Hoping"),
    ).resolves.toBeTruthy();
  });

  it("does not stop two facilities being used at once", async () => {
    await book(busId, "2027-04-13T10:00Z", "2027-04-13T12:00Z", "approved", "Bus");
    await expect(
      book(hallId, "2027-04-13T10:00Z", "2027-04-13T12:00Z", "approved", "Hall"),
    ).resolves.toBeTruthy();
  });
});
