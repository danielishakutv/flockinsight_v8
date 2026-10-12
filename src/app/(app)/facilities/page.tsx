import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { PlanGate } from "@/components/app/plan-gate";
import {
  calendarFor,
  listBookings,
  listClosures,
  listFacilities,
} from "@/lib/facilities";
import type { FacilityRate } from "@/lib/facility-shared";
import {
  FacilitiesBrowser,
  type BookingRow,
  type ClosureRow,
  type FacilityCard,
} from "@/components/facilities/facilities-browser";

export const metadata = { title: "Facilities" };

/** Always current — a booking made on a phone should be there on the next load. */
export const dynamic = "force-dynamic";

/**
 * Facilities: what the church owns, and who has it when.
 *
 * A Pro feature, open to every church on that plan. `PlanGate` marks the page
 * for anyone below it and every write is refused on the server, so reaching
 * this URL on Starter shows the upgrade prompt rather than the module.
 */
export default async function FacilitiesPage() {
  const { church } = await requireChurch();
  await requireCan("facilities.view");
  const canManage = await can("facilities.manage");

  /*
   * Three months either side of today.
   *
   * Wide enough that paging the calendar back and forth feels instant, narrow
   * enough that a church with years of bookings is not sending all of them to
   * a phone. The calendar pages within what it was given.
   */
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 4, 1);

  /*
   * The list is two queries, merged, and neither is "the first 500".
   *
   * It used to be `listBookings({ limit: 500 })` — oldest first, no window — so
   * once a church passed 500 bookings it was shown its 500 OLDEST: new requests
   * waiting for approval and next week's bookings fell off the end, the
   * approval panel never appeared, and only the badge (a separate count) knew
   * there was anything to decide. Now: everything from the calendar's window
   * onward (latest kept if it ever fills), plus every request still waiting
   * however far out it is.
   */
  const [places, recentBookings, openRequests, closures, calendar, memberRows] = await Promise.all([
    listFacilities(church.id),
    listBookings(church.id, { from, limit: 1000, order: "desc" }),
    listBookings(church.id, { statuses: ["requested"], limit: 5000 }),
    listClosures(church.id, { from, to }),
    calendarFor(church.id, from, to),
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(and(eq(member.churchId, church.id), eq(member.status, "active")))
      .orderBy(asc(member.firstName), asc(member.lastName))
      .limit(5000),
  ]);

  const seen = new Set<string>();
  const bookings = [...openRequests, ...recentBookings]
    .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const facilities: FacilityCard[] = places.map((f) => ({
    id: f.id,
    name: f.name,
    kind: f.kind,
    location: f.location,
    description: f.description,
    capacity: f.capacity,
    isActive: f.isActive,
    isBookable: f.isBookable,
    requiresApproval: f.requiresApproval,
    bufferMinutes: f.bufferMinutes,
    hireFee: f.hireFee,
    rate: f.rate as FacilityRate,
    notes: f.notes,
    contactName:
      [f.contactFirstName, f.contactLastName].filter(Boolean).join(" ") || null,
  }));

  const bookingRows: BookingRow[] = bookings.map((b) => ({
    id: b.id,
    facilityId: b.facilityId,
    facilityName: b.facilityName,
    title: b.title,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    isExternal: b.isExternal,
    who:
      [b.memberFirstName, b.memberLastName].filter(Boolean).join(" ") ||
      b.requesterName ||
      b.groupName ||
      null,
    expectedAttendance: b.expectedAttendance,
    fee: b.fee,
    feePaid: b.feePaid,
    notes: b.notes,
    decisionNote: b.decisionNote,
  }));

  const closureRows: ClosureRow[] = closures.map((c) => ({
    id: c.id,
    facilityId: c.facilityId,
    facilityName: c.facilityName,
    kind: c.kind,
    reason: c.reason,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    cost: c.cost,
  }));

  return (
    <PageContainer>
      <PlanGate feature="facilities" />

      <PageHeader
        title="Facilities"
        description="The halls, rooms, grounds and equipment the church owns — booked on one calendar. Nothing can be booked over something already approved."
      />

      <FacilitiesBrowser
        facilities={facilities}
        bookings={bookingRows}
        closures={closureRows}
        calendar={calendar}
        members={memberRows.map((m) => ({
          id: m.id,
          name: [m.firstName, m.lastName].filter(Boolean).join(" "),
        }))}
        currency={church.currency ?? "NGN"}
        canManage={canManage}
      />
    </PageContainer>
  );
}
