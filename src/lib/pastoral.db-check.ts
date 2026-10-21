/**
 * Pastoral appointments against a real database. Run with `pnpm test:db`.
 *
 * One invariant is worth all of this: two appointments that hold a slot
 * (pending or confirmed) never overlap for one pastor, buffer included. The
 * unit tests cover the slot RULES; only a real Postgres can say what happens
 * when two people press "Book" on the same time at the same moment, because
 * the thing under test is READ COMMITTED itself (AGENTS.md, "db.transaction
 * is not isolation"). So: a single contested slot, two deliberately
 * interleaved transactions, and a count afterwards.
 *
 * Creates its own church and login, and removes exactly what it created (the
 * church cascades to every pastoral row).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { church, pastorProfile, pastoralAppointment, user } from "@/db/schema";
import {
  busyFor,
  claimAppointment,
  lockPastorForBooking,
  setStatus,
} from "@/lib/pastoral";
import { isBookingOverlapViolation } from "@/lib/facilities";
import { isOfferedSlot, type SlotRules } from "@/lib/pastoral-slots";

const stamp = Date.now().toString(36);
const churchId = `pastoral-check-${stamp}`;
const userId = `zzcheck-pastor-${stamp}`;
let pastorId = "";

const LAGOS = "Africa/Lagos";
// A Monday far enough ahead that minimum notice never interferes.
const NOW = new Date("2030-01-01T00:00:00Z");
const RULES: SlotRules = {
  timeZone: LAGOS,
  hours: [{ weekday: 1, startMinute: 540, endMinute: 720 }],
  slotMinutes: 30,
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 30,
};
// Monday 2030-01-07, 09:00 local.
const SLOT = "2030-01-07T08:00:00.000Z";

const values = (name: string) => ({
  pastorName: "Pastor Check",
  typeName: "Counselling",
  status: "confirmed" as const,
  source: "staff" as const,
  bookerName: name,
});

async function holding(startsAt: string): Promise<number> {
  const rows = await db
    .select({ id: pastoralAppointment.id, status: pastoralAppointment.status })
    .from(pastoralAppointment)
    .where(and(eq(pastoralAppointment.pastorId, pastorId), eq(pastoralAppointment.startsAt, new Date(startsAt))));
  return rows.filter((r) => r.status === "pending" || r.status === "confirmed").length;
}

beforeAll(async () => {
  await db.insert(user).values({ id: userId, name: "Pastor Check", email: `${userId}@example.invalid` });
  await db.insert(church).values({ id: churchId, name: `Pastoral Check ${stamp}`, slug: churchId });
  const [p] = await db
    .insert(pastorProfile)
    .values({ churchId, userId, displayName: "Pastor Check", slotMinutes: 30 })
    .returning({ id: pastorProfile.id });
  pastorId = p.id;
});

afterAll(async () => {
  await db.delete(church).where(eq(church.id, churchId));
  await db.delete(user).where(eq(user.id, userId));
});

describe("the booking claim", () => {
  it("lets exactly one of two interleaved bookings take one contested slot", async () => {
    /*
     * Transaction A takes the pastor lock and reads the diary. While it holds
     * the lock, B starts the full claim and must wait on the FOR UPDATE. A
     * then writes and commits; B wakes, re-reads under the lock, sees A's row
     * and refuses. Without the lock both would read an empty diary and both
     * would insert (the constraint would then refuse one; the lock is what
     * makes the answer a clean "taken" instead of an exception).
     */
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let bStarted!: Promise<Awaited<ReturnType<typeof claimAppointment>>>;

    const a = db.transaction(async (tx) => {
      expect(await lockPastorForBooking(tx, churchId, pastorId)).toBe(true);
      const busy = await busyFor(tx, churchId, pastorId, new Date(SLOT), new Date(Date.parse(SLOT) + 86_400_000));
      const slot = isOfferedSlot(RULES, busy, SLOT, NOW);
      expect(slot).not.toBeNull();
      bStarted = claimAppointment({
        churchId,
        pastorId,
        rules: RULES,
        startsAt: SLOT,
        now: NOW,
        values: values("Booker B"),
      });
      // Give B time to reach the lock and block on it.
      await new Promise((r) => setTimeout(r, 300));
      await tx.insert(pastoralAppointment).values({
        ...values("Booker A"),
        churchId,
        pastorId,
        startsAt: new Date(slot!.startsAt),
        endsAt: new Date(slot!.endsAt),
        holdsUntil: new Date(slot!.holdsUntil),
      });
      release();
    });

    await held;
    await a;
    const b = await bStarted;
    expect(b.ok).toBe(false);
    expect(!b.ok && b.reason).toBe("taken");
    expect(await holding(SLOT)).toBe(1);
  });

  it("is refused by the exclusion constraint even when the lock is bypassed", async () => {
    let error: unknown = null;
    try {
      await db.insert(pastoralAppointment).values({
        ...values("Raw insert"),
        churchId,
        pastorId,
        startsAt: new Date("2030-01-07T08:15:00Z"),
        endsAt: new Date("2030-01-07T08:45:00Z"),
        holdsUntil: new Date("2030-01-07T08:45:00Z"),
      });
    } catch (e) {
      error = e;
    }
    expect(isBookingOverlapViolation(error)).toBe(true);
  });

  it("frees the slot once the holder is cancelled", async () => {
    const [row] = await db
      .select({ id: pastoralAppointment.id })
      .from(pastoralAppointment)
      .where(and(eq(pastoralAppointment.pastorId, pastorId), eq(pastoralAppointment.startsAt, new Date(SLOT))))
      .limit(1);
    await setStatus({ id: row.id, churchId, from: ["pending", "confirmed"], to: "cancelled" });
    const again = await claimAppointment({
      churchId,
      pastorId,
      rules: RULES,
      startsAt: SLOT,
      now: NOW,
      values: values("Booker C"),
    });
    expect(again.ok).toBe(true);
  });

  it("refuses an appointment that starts inside another's buffer", async () => {
    // 10:00-10:30 local held until 11:00 by a 30-minute buffer.
    await db.insert(pastoralAppointment).values({
      ...values("Buffered"),
      churchId,
      pastorId,
      startsAt: new Date("2030-01-07T09:00:00Z"),
      endsAt: new Date("2030-01-07T09:30:00Z"),
      holdsUntil: new Date("2030-01-07T10:00:00Z"),
    });
    let error: unknown = null;
    try {
      await db.insert(pastoralAppointment).values({
        ...values("Too close"),
        churchId,
        pastorId,
        startsAt: new Date("2030-01-07T09:30:00Z"),
        endsAt: new Date("2030-01-07T10:00:00Z"),
        holdsUntil: new Date("2030-01-07T10:00:00Z"),
      });
    } catch (e) {
      error = e;
    }
    expect(isBookingOverlapViolation(error)).toBe(true);

    // Starting exactly when the buffer ends is allowed: the range is half-open.
    const [ok] = await db
      .insert(pastoralAppointment)
      .values({
        ...values("Right after"),
        churchId,
        pastorId,
        startsAt: new Date("2030-01-07T10:00:00Z"),
        endsAt: new Date("2030-01-07T10:30:00Z"),
        holdsUntil: new Date("2030-01-07T10:30:00Z"),
      })
      .returning({ id: pastoralAppointment.id });
    expect(ok.id).toBeTruthy();
  });
});

describe("decisions on one appointment", () => {
  it("lets only one of a simultaneous Confirm and Cancel win", async () => {
    const [row] = await db
      .insert(pastoralAppointment)
      .values({
        ...values("Pending"),
        status: "pending",
        churchId,
        pastorId,
        startsAt: new Date("2030-01-14T08:00:00Z"),
        endsAt: new Date("2030-01-14T08:30:00Z"),
        holdsUntil: new Date("2030-01-14T08:30:00Z"),
      })
      .returning({ id: pastoralAppointment.id });

    const [confirmed, cancelled] = await Promise.all([
      setStatus({ id: row.id, churchId, from: ["pending"], to: "confirmed" }),
      setStatus({ id: row.id, churchId, from: ["pending"], to: "cancelled" }),
    ]);
    expect([confirmed, cancelled].filter(Boolean)).toHaveLength(1);
  });

  it("lets two reminder workers claim one reminder exactly once", async () => {
    const [row] = await db
      .insert(pastoralAppointment)
      .values({
        ...values("Reminded"),
        churchId,
        pastorId,
        startsAt: new Date("2030-01-14T09:00:00Z"),
        endsAt: new Date("2030-01-14T09:30:00Z"),
        holdsUntil: new Date("2030-01-14T09:30:00Z"),
        remindAt: new Date("2030-01-13T18:00:00Z"),
      })
      .returning({ id: pastoralAppointment.id });

    const claim = () =>
      db
        .update(pastoralAppointment)
        .set({ reminderSentAt: new Date() })
        .where(
          and(
            eq(pastoralAppointment.id, row.id),
            isNull(pastoralAppointment.reminderSentAt),
            eq(pastoralAppointment.status, "confirmed"),
          ),
        )
        .returning({ id: pastoralAppointment.id });
    const [one, two] = await Promise.all([claim(), claim()]);
    expect(one.length + two.length).toBe(1);
  });

  it("never touches another church's appointment", async () => {
    const [row] = await db
      .select({ id: pastoralAppointment.id })
      .from(pastoralAppointment)
      .where(eq(pastoralAppointment.churchId, churchId))
      .limit(1);
    expect(await setStatus({ id: row.id, churchId: "some-other-church", from: ["pending", "confirmed"], to: "cancelled" })).toBeNull();
  });
});
