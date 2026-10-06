"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facility, facilityBooking, facilityClosure, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { recordAudit } from "@/lib/audit";
import { clashesFor, getFacility } from "@/lib/facilities";
import { feeFor, validateBooking } from "@/lib/facility-shared";

export type Result<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; clashes?: { label: string; reason: string }[] };

const KINDS = ["hall", "room", "open_space", "equipment", "vehicle", "other"] as const;
const RATES = ["free", "hour", "day", "session"] as const;
const CLOSURE_KINDS = ["maintenance", "repair", "cleaning", "reserved", "other"] as const;

/**
 * Every write goes through here first.
 *
 * `facilities` is a Pro feature AND a pilot, so `refuseWithoutFeature` answers
 * both questions at once — a church outside the pilot is refused on the server
 * even if it somehow reached the URL.
 */
type Guard =
  | { allowed: true; church: { id: string }; user: { id: string; name: string } }
  | { allowed: false; bad: { ok: false; error: string } };

async function guard(
  need: "facilities.view" | "facilities.manage",
): Promise<Guard> {
  const { church, user } = await requireChurch();
  const gate = await refuseWithoutFeature("facilities");
  if (gate) return { allowed: false, bad: { ok: false, error: gate.error } };
  if (!(await can(need))) {
    return {
      allowed: false,
      bad: { ok: false, error: "You don't have permission to do that." },
    };
  }
  return { allowed: true, church, user };
}

function refresh() {
  revalidatePath("/facilities");
}

/* ------------------------------------------------------------------ *
 * The register
 * ------------------------------------------------------------------ */

const facilitySchema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(120),
  kind: z.enum(KINDS).optional(),
  location: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(2000).nullish(),
  capacity: z.coerce.number().int().min(0).max(1_000_000).nullish(),
  photoUrl: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
  isBookable: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  bufferMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  hireFee: z.coerce.number().min(0).max(1_000_000_000).nullish(),
  rate: z.enum(RATES).optional(),
  contactMemberId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type FacilityInput = z.input<typeof facilitySchema>;

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/** The contact must be one of OUR members, not a uuid from another church. */
async function validContact(churchId: string, id: string | null | undefined) {
  if (!id) return null;
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, id), eq(member.churchId, churchId)))
    .limit(1);
  return row?.id ?? null;
}

export async function saveFacility(
  input: FacilityInput,
  id?: string,
): Promise<Result<{ id: string }>> {
  const g = await guard("facilities.manage");
  if (!g.allowed) return g.bad;

  const parsed = facilitySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  const values = {
    churchId: g.church.id,
    name: d.name,
    kind: d.kind ?? "hall",
    location: clean(d.location),
    description: clean(d.description),
    capacity: d.capacity ?? null,
    photoUrl: clean(d.photoUrl),
    isActive: d.isActive ?? true,
    isBookable: d.isBookable ?? true,
    requiresApproval: d.requiresApproval ?? true,
    bufferMinutes: d.bufferMinutes ?? 0,
    hireFee: d.rate === "free" ? null : (d.hireFee ?? null),
    rate: d.rate ?? "free",
    contactMemberId: await validContact(g.church.id, d.contactMemberId),
    notes: clean(d.notes),
  };

  if (id) {
    const existing = await getFacility(g.church.id, id);
    if (!existing) return { ok: false, error: "That is no longer on your register." };
    await db.update(facility).set(values).where(eq(facility.id, id));
    await recordAudit({
      actorUserId: g.user.id,
      actorName: g.user.name,
      churchId: g.church.id,
      action: "facility_update",
      summary: `Updated the facility "${d.name}"`,
      targetType: "facility",
      targetId: id,
    });
    refresh();
    return { ok: true, id };
  }

  const [row] = await db
    .insert(facility)
    .values({ ...values, createdBy: g.user.id })
    .returning({ id: facility.id });

  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: "facility_add",
    summary: `Added "${d.name}" to the facilities register`,
    targetType: "facility",
    targetId: row.id,
  });
  refresh();
  return { ok: true, id: row.id };
}

/**
 * Retire rather than delete.
 *
 * A hall the church stopped using still has last year's bookings hanging off
 * it, and removing it would take the record of who used what with it. There is
 * deliberately no delete action in this module.
 */
export async function setFacilityActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const g = await guard("facilities.manage");
  if (!g.allowed) return g.bad;

  const existing = await getFacility(g.church.id, id);
  if (!existing) return { ok: false, error: "That is no longer on your register." };

  await db.update(facility).set({ isActive }).where(eq(facility.id, id));
  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: "facility_update",
    summary: `${isActive ? "Brought back" : "Retired"} the facility "${existing.name}"`,
    targetType: "facility",
    targetId: id,
  });
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Bookings
 * ------------------------------------------------------------------ */

const bookingSchema = z.object({
  facilityId: z.string().uuid("Choose what is being booked"),
  title: z.string().trim().min(2, "Give the booking a name").max(160),
  purpose: z.string().trim().max(2000).nullish(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  memberId: z.string().uuid().nullish(),
  requesterName: z.string().trim().max(120).nullish(),
  requesterPhone: z.string().trim().max(40).nullish(),
  requesterEmail: z.string().trim().max(160).nullish(),
  isExternal: z.boolean().optional(),
  groupId: z.string().uuid().nullish(),
  expectedAttendance: z.coerce.number().int().min(0).max(1_000_000).nullish(),
  fee: z.coerce.number().min(0).max(1_000_000_000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type BookingInput = z.input<typeof bookingSchema>;

export async function saveBooking(
  input: BookingInput,
  id?: string,
): Promise<Result<{ id: string; status: string; message: string }>> {
  const g = await guard("facilities.view");
  if (!g.allowed) return g.bad;
  const canManage = await can("facilities.manage");

  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  const f = await getFacility(g.church.id, d.facilityId);
  if (!f) return { ok: false, error: "That is not on your register." };
  if (!f.isBookable) return { ok: false, error: `${f.name} is not something that can be booked.` };
  if (!f.isActive) return { ok: false, error: `${f.name} has been retired.` };

  const valid = validateBooking(
    {
      facilityId: d.facilityId,
      title: d.title,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      expectedAttendance: d.expectedAttendance ?? null,
    },
    { capacity: f.capacity },
  );
  if (!valid.ok) return { ok: false, error: valid.error };
  const v = valid.value;

  /*
   * A booking that would hold the slot is checked against everything else that
   * already holds it. A mere request is not — two people may ask for the same
   * Saturday, and whoever approves one decides between them. The check runs
   * again at approval, which is the moment it actually matters.
   */
  const willHold = canManage && !f.requiresApproval;
  if (willHold) {
    const clashes = await clashesFor({
      churchId: g.church.id,
      facilityId: d.facilityId,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      ignoreBookingId: id,
      bufferMinutes: f.bufferMinutes,
    });
    if (clashes.length > 0) {
      return {
        ok: false,
        error: `${f.name} is not free then.`,
        clashes: clashes.map((c) => ({ label: c.with.label, reason: c.reason })),
      };
    }
  }

  const status = willHold ? "approved" : "requested";
  const fee = d.fee ?? feeFor(f.rate, f.hireFee, { startsAt: v.startsAt, endsAt: v.endsAt });

  const values = {
    churchId: g.church.id,
    facilityId: d.facilityId,
    title: v.title,
    purpose: clean(d.purpose),
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    memberId: await validContact(g.church.id, d.memberId),
    requesterName: clean(d.requesterName),
    requesterPhone: clean(d.requesterPhone),
    requesterEmail: clean(d.requesterEmail),
    isExternal: d.isExternal ?? false,
    groupId: d.groupId ?? null,
    expectedAttendance: d.expectedAttendance ?? null,
    fee,
    notes: clean(d.notes),
  };

  if (id) {
    const [existing] = await db
      .select({ id: facilityBooking.id, title: facilityBooking.title })
      .from(facilityBooking)
      .where(and(eq(facilityBooking.id, id), eq(facilityBooking.churchId, g.church.id)))
      .limit(1);
    if (!existing) return { ok: false, error: "That booking no longer exists." };
    if (!canManage) return { ok: false, error: "Only someone who manages facilities can change a booking." };

    await db.update(facilityBooking).set(values).where(eq(facilityBooking.id, id));
    await recordAudit({
      actorUserId: g.user.id,
      actorName: g.user.name,
      churchId: g.church.id,
      action: "facility_booking_update",
      summary: `Changed the booking "${v.title}" for ${f.name}`,
      targetType: "facility_booking",
      targetId: id,
    });
    refresh();
    return { ok: true, id, status: "updated", message: "Booking updated." };
  }

  const [row] = await db
    .insert(facilityBooking)
    .values({
      ...values,
      status,
      approvedBy: status === "approved" ? g.user.id : null,
      approvedAt: status === "approved" ? new Date() : null,
      createdBy: g.user.id,
    })
    .returning({ id: facilityBooking.id });

  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: "facility_booking_add",
    summary:
      status === "approved"
        ? `Booked ${f.name} for "${v.title}"`
        : `Requested ${f.name} for "${v.title}"`,
    targetType: "facility_booking",
    targetId: row.id,
  });
  refresh();

  return {
    ok: true,
    id: row.id,
    status,
    message:
      status === "approved"
        ? `${f.name} is booked.`
        : `Requested. Somebody who manages facilities will confirm it.`,
  };
}

/**
 * Approve, decline or cancel.
 *
 * Approving re-runs the clash check, and that is not belt-and-braces — it is
 * the only check that counts. Two people can both REQUEST the same Saturday;
 * the first approval takes the slot and the second must be refused, however
 * long ago it was asked for.
 */
export async function decideBooking(
  id: string,
  decision: "approved" | "declined" | "cancelled",
  note?: string,
): Promise<Result<{ message: string }>> {
  const g = await guard("facilities.manage");
  if (!g.allowed) return g.bad;

  const [b] = await db
    .select({
      id: facilityBooking.id,
      title: facilityBooking.title,
      facilityId: facilityBooking.facilityId,
      startsAt: facilityBooking.startsAt,
      endsAt: facilityBooking.endsAt,
      status: facilityBooking.status,
    })
    .from(facilityBooking)
    .where(and(eq(facilityBooking.id, id), eq(facilityBooking.churchId, g.church.id)))
    .limit(1);
  if (!b) return { ok: false, error: "That booking no longer exists." };

  const f = await getFacility(g.church.id, b.facilityId);
  if (!f) return { ok: false, error: "That facility is no longer on your register." };

  if (decision === "approved") {
    const clashes = await clashesFor({
      churchId: g.church.id,
      facilityId: b.facilityId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      ignoreBookingId: id,
      bufferMinutes: f.bufferMinutes,
    });
    if (clashes.length > 0) {
      return {
        ok: false,
        error: `${f.name} is no longer free then — something else was approved first.`,
        clashes: clashes.map((c) => ({ label: c.with.label, reason: c.reason })),
      };
    }
  }

  await db
    .update(facilityBooking)
    .set({
      status: decision,
      decisionNote: clean(note),
      approvedBy: decision === "approved" ? g.user.id : null,
      approvedAt: decision === "approved" ? new Date() : null,
    })
    .where(eq(facilityBooking.id, id));

  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: `facility_booking_${decision}`,
    summary: `${
      decision === "approved" ? "Approved" : decision === "declined" ? "Declined" : "Cancelled"
    } "${b.title}" for ${f.name}`,
    targetType: "facility_booking",
    targetId: id,
  });
  refresh();

  return {
    ok: true,
    message:
      decision === "approved"
        ? `${f.name} is booked for "${b.title}".`
        : decision === "declined"
          ? "Declined, with your reason recorded."
          : "Cancelled. The slot is free again.",
  };
}

/** Mark the hire fee paid, or not. */
export async function setFeePaid(id: string, paid: boolean): Promise<Result> {
  const g = await guard("facilities.manage");
  if (!g.allowed) return g.bad;

  const [b] = await db
    .select({ id: facilityBooking.id, title: facilityBooking.title })
    .from(facilityBooking)
    .where(and(eq(facilityBooking.id, id), eq(facilityBooking.churchId, g.church.id)))
    .limit(1);
  if (!b) return { ok: false, error: "That booking no longer exists." };

  await db.update(facilityBooking).set({ feePaid: paid }).where(eq(facilityBooking.id, id));
  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: "facility_booking_update",
    summary: `Marked the hire fee for "${b.title}" as ${paid ? "paid" : "unpaid"}`,
    targetType: "facility_booking",
    targetId: id,
  });
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Closures — and the maintenance record
 * ------------------------------------------------------------------ */

const closureSchema = z.object({
  facilityId: z.string().uuid("Choose which facility"),
  kind: z.enum(CLOSURE_KINDS).optional(),
  reason: z.string().trim().min(2, "Say why it is closed").max(300),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  cost: z.coerce.number().min(0).max(1_000_000_000).nullish(),
});

export type ClosureInput = z.input<typeof closureSchema>;

export async function saveClosure(input: ClosureInput): Promise<Result<{ id: string }>> {
  const g = await guard("facilities.manage");
  if (!g.allowed) return g.bad;

  const parsed = closureSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  const f = await getFacility(g.church.id, d.facilityId);
  if (!f) return { ok: false, error: "That is not on your register." };

  const starts = new Date(d.startsAt);
  const ends = new Date(d.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()))
    return { ok: false, error: "Those dates are not real dates." };
  if (ends.getTime() <= starts.getTime())
    return { ok: false, error: "It has to end after it starts." };

  /*
   * A closure over an APPROVED booking is refused rather than silently
   * winning. Somebody is expecting that hall, and the honest answer is to say
   * whose booking is in the way so a person can ring them — not to shut the
   * building under them.
   */
  const clashes = await clashesFor({
    churchId: g.church.id,
    facilityId: d.facilityId,
    startsAt: starts,
    endsAt: ends,
    bufferMinutes: 0,
  });
  const bookingClashes = clashes.filter((c) => c.with.sort === "booking");
  if (bookingClashes.length > 0) {
    return {
      ok: false,
      error: `${f.name} has bookings in that period. Cancel or move them first.`,
      clashes: bookingClashes.map((c) => ({ label: c.with.label, reason: c.reason })),
    };
  }

  const [row] = await db
    .insert(facilityClosure)
    .values({
      churchId: g.church.id,
      facilityId: d.facilityId,
      kind: d.kind ?? "maintenance",
      reason: d.reason,
      startsAt: starts,
      endsAt: ends,
      cost: d.cost ?? null,
      createdBy: g.user.id,
    })
    .returning({ id: facilityClosure.id });

  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: "facility_closure_add",
    summary: `Closed ${f.name}: ${d.reason}`,
    targetType: "facility_closure",
    targetId: row.id,
  });
  refresh();
  return { ok: true, id: row.id };
}

export async function removeClosure(id: string): Promise<Result> {
  const g = await guard("facilities.manage");
  if (!g.allowed) return g.bad;

  const [c] = await db
    .select({ id: facilityClosure.id, reason: facilityClosure.reason })
    .from(facilityClosure)
    .where(and(eq(facilityClosure.id, id), eq(facilityClosure.churchId, g.church.id)))
    .limit(1);
  if (!c) return { ok: true };

  await db.delete(facilityClosure).where(eq(facilityClosure.id, id));
  await recordAudit({
    actorUserId: g.user.id,
    actorName: g.user.name,
    churchId: g.church.id,
    action: "facility_closure_remove",
    summary: `Reopened after: ${c.reason}`,
    targetType: "facility_closure",
    targetId: id,
  });
  refresh();
  return { ok: true };
}
