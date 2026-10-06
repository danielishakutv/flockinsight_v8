import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  facility,
  facilityBooking,
  facilityClosure,
  group,
  member,
  user,
} from "@/db/schema";
import {
  blocksTheSlot,
  findClashes,
  type ClashCandidate,
} from "@/lib/facility-shared";

/**
 * Reading and writing facilities.
 *
 * The one thing in here that is not a plain query is `clashesFor`, and it is
 * the reason the module exists: an approved booking must never overlap another
 * approved booking on the same facility, nor a closure.
 */

export type FacilityRow = typeof facility.$inferSelect;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listFacilities(churchId: string) {
  const contact = alias(member, "facility_contact");
  return db
    .select({
      id: facility.id,
      name: facility.name,
      kind: facility.kind,
      location: facility.location,
      description: facility.description,
      capacity: facility.capacity,
      photoUrl: facility.photoUrl,
      isActive: facility.isActive,
      isBookable: facility.isBookable,
      requiresApproval: facility.requiresApproval,
      bufferMinutes: facility.bufferMinutes,
      hireFee: facility.hireFee,
      rate: facility.rate,
      notes: facility.notes,
      contactMemberId: facility.contactMemberId,
      contactFirstName: contact.firstName,
      contactLastName: contact.lastName,
    })
    .from(facility)
    // Scoped to the same church, not merely matched on id: `contact_member_id`
    // references `member.id` globally, and an unscoped join is how one church's
    // member name ends up printed on another church's page.
    .leftJoin(
      contact,
      and(
        eq(contact.id, facility.contactMemberId),
        eq(contact.churchId, facility.churchId),
      ),
    )
    .where(eq(facility.churchId, churchId))
    .orderBy(desc(facility.isActive), asc(facility.sortOrder), asc(facility.name));
}

export async function getFacility(churchId: string, id: string) {
  const [row] = await db
    .select()
    .from(facility)
    .where(and(eq(facility.id, id), eq(facility.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

/** Bookings overlapping a window, with who asked and what for. */
export async function listBookings(
  churchId: string,
  opts: {
    from?: Date;
    to?: Date;
    facilityId?: string;
    statuses?: string[];
    limit?: number;
  } = {},
) {
  const who = alias(member, "booking_member");
  const approver = alias(user, "booking_approver");

  const where = [eq(facilityBooking.churchId, churchId)];
  // Overlap, not containment: a booking that started yesterday and ends
  // tomorrow belongs on today's calendar.
  if (opts.to) where.push(lt(facilityBooking.startsAt, opts.to));
  if (opts.from) where.push(gte(facilityBooking.endsAt, opts.from));
  if (opts.facilityId) where.push(eq(facilityBooking.facilityId, opts.facilityId));
  if (opts.statuses?.length)
    where.push(
      inArray(
        facilityBooking.status,
        opts.statuses as (typeof facilityBooking.status.enumValues)[number][],
      ),
    );

  return db
    .select({
      id: facilityBooking.id,
      facilityId: facilityBooking.facilityId,
      facilityName: facility.name,
      title: facilityBooking.title,
      purpose: facilityBooking.purpose,
      startsAt: facilityBooking.startsAt,
      endsAt: facilityBooking.endsAt,
      status: facilityBooking.status,
      isExternal: facilityBooking.isExternal,
      memberId: facilityBooking.memberId,
      memberFirstName: who.firstName,
      memberLastName: who.lastName,
      requesterName: facilityBooking.requesterName,
      requesterPhone: facilityBooking.requesterPhone,
      groupId: facilityBooking.groupId,
      groupName: group.name,
      expectedAttendance: facilityBooking.expectedAttendance,
      fee: facilityBooking.fee,
      feePaid: facilityBooking.feePaid,
      decisionNote: facilityBooking.decisionNote,
      notes: facilityBooking.notes,
      approvedAt: facilityBooking.approvedAt,
      approverName: approver.name,
      createdAt: facilityBooking.createdAt,
    })
    .from(facilityBooking)
    .innerJoin(facility, eq(facility.id, facilityBooking.facilityId))
    .leftJoin(
      who,
      and(eq(who.id, facilityBooking.memberId), eq(who.churchId, facilityBooking.churchId)),
    )
    .leftJoin(
      group,
      and(eq(group.id, facilityBooking.groupId), eq(group.churchId, facilityBooking.churchId)),
    )
    .leftJoin(approver, eq(approver.id, facilityBooking.approvedBy))
    .where(and(...where))
    .orderBy(asc(facilityBooking.startsAt))
    .limit(opts.limit ?? 500);
}

export async function listClosures(
  churchId: string,
  opts: { from?: Date; to?: Date; facilityId?: string } = {},
) {
  const where = [eq(facilityClosure.churchId, churchId)];
  if (opts.to) where.push(lt(facilityClosure.startsAt, opts.to));
  if (opts.from) where.push(gte(facilityClosure.endsAt, opts.from));
  if (opts.facilityId) where.push(eq(facilityClosure.facilityId, opts.facilityId));

  return db
    .select({
      id: facilityClosure.id,
      facilityId: facilityClosure.facilityId,
      facilityName: facility.name,
      kind: facilityClosure.kind,
      reason: facilityClosure.reason,
      startsAt: facilityClosure.startsAt,
      endsAt: facilityClosure.endsAt,
      cost: facilityClosure.cost,
      createdAt: facilityClosure.createdAt,
    })
    .from(facilityClosure)
    .innerJoin(facility, eq(facility.id, facilityClosure.facilityId))
    .where(and(...where))
    .orderBy(asc(facilityClosure.startsAt))
    .limit(500);
}

/** How many requests are waiting on somebody. Drives the badge. */
export async function pendingCount(churchId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(facilityBooking)
    .where(
      and(
        eq(facilityBooking.churchId, churchId),
        eq(facilityBooking.status, "requested"),
      ),
    );
  return Number(row?.n ?? 0);
}

/* ------------------------------------------------------------------ *
 * The clash check
 * ------------------------------------------------------------------ */

/**
 * Everything standing in the way of a proposed booking.
 *
 * Reads only what could possibly overlap — a window one day wider than the
 * proposal on each side, which comfortably covers any buffer — rather than
 * every booking the facility has ever had.
 *
 * Only APPROVED bookings are considered. A pending request does not hold the
 * slot; that is the whole point of it being a request, and two people may ask
 * for the same Saturday.
 */
export async function clashesFor(args: {
  churchId: string;
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  ignoreBookingId?: string;
  bufferMinutes: number;
}) {
  const pad = 86_400_000 + Math.max(0, args.bufferMinutes) * 60_000;
  const from = new Date(args.startsAt.getTime() - pad);
  const to = new Date(args.endsAt.getTime() + pad);

  const [bookings, closures] = await Promise.all([
    db
      .select({
        id: facilityBooking.id,
        title: facilityBooking.title,
        startsAt: facilityBooking.startsAt,
        endsAt: facilityBooking.endsAt,
      })
      .from(facilityBooking)
      .where(
        and(
          eq(facilityBooking.churchId, args.churchId),
          eq(facilityBooking.facilityId, args.facilityId),
          eq(facilityBooking.status, "approved"),
          lt(facilityBooking.startsAt, to),
          gte(facilityBooking.endsAt, from),
          args.ignoreBookingId
            ? ne(facilityBooking.id, args.ignoreBookingId)
            : undefined,
        ),
      ),
    db
      .select({
        id: facilityClosure.id,
        reason: facilityClosure.reason,
        startsAt: facilityClosure.startsAt,
        endsAt: facilityClosure.endsAt,
      })
      .from(facilityClosure)
      .where(
        and(
          eq(facilityClosure.churchId, args.churchId),
          eq(facilityClosure.facilityId, args.facilityId),
          lt(facilityClosure.startsAt, to),
          gte(facilityClosure.endsAt, from),
        ),
      ),
  ]);

  const candidates: ClashCandidate[] = [
    ...bookings.map((b) => ({
      id: b.id,
      label: b.title,
      sort: "booking" as const,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    })),
    ...closures.map((c) => ({
      id: c.id,
      label: c.reason,
      sort: "closure" as const,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
    })),
  ];

  return findClashes(
    { startsAt: args.startsAt, endsAt: args.endsAt },
    candidates,
    { bufferMinutes: args.bufferMinutes, ignoreId: args.ignoreBookingId },
  );
}

/** Re-export so a caller does not have to know where the rule lives. */
export { blocksTheSlot };

/* ------------------------------------------------------------------ *
 * A month at a glance
 * ------------------------------------------------------------------ */

export type CalendarEntry = {
  id: string;
  kind: "booking" | "closure";
  facilityId: string;
  facilityName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

/** Bookings and closures together, which is how a calendar has to read them. */
export async function calendarFor(
  churchId: string,
  from: Date,
  to: Date,
  facilityId?: string,
): Promise<CalendarEntry[]> {
  const [bookings, closures] = await Promise.all([
    listBookings(churchId, {
      from,
      to,
      facilityId,
      // A declined booking is not on the calendar; a cancelled one is not
      // either. Both stay on the facility's own list, where the history is.
      statuses: ["requested", "approved"],
    }),
    listClosures(churchId, { from, to, facilityId }),
  ]);

  return [
    ...bookings.map((b) => ({
      id: b.id,
      kind: "booking" as const,
      facilityId: b.facilityId,
      facilityName: b.facilityName,
      title: b.title,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
    })),
    ...closures.map((c) => ({
      id: c.id,
      kind: "closure" as const,
      facilityId: c.facilityId,
      facilityName: c.facilityName,
      title: c.reason,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      status: c.kind,
    })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Everything a church has booked, for the reports module. */
export async function facilityExportRows(churchId: string) {
  return listBookings(churchId, { limit: 5000 });
}
