"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  pastorBookingType,
  pastorClosure,
  pastorHours,
  pastorProfile,
  pastoralAppointment,
  pastoralBookingPage,
  pastoralBookingType,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { hasFeature, refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";
import { weekdayNames } from "@/lib/i18n/formatting";
import { accessHas, loadStaffAccess } from "@/lib/staff-permissions";
import { churchDial } from "@/lib/member-signup";
import { registerFirstTimer } from "@/lib/first-timer-intake";
import { instantFromWallClock } from "@/lib/meeting-recurrence";
import { isRealCalendarDate } from "@/lib/calendar-date";
import {
  busyFor,
  claimAppointment,
  ensureBookingPage,
  getAppointment,
  getPastor,
  getType,
  hoursOf,
  isOnTeam,
  isUniqueViolation,
  listAppointments,
  listTypes,
  lockPastorForBooking,
  moveAppointment,
  openSlots,
  pastorOffersType,
  regenerateBookingSlug as regenerateSlug,
  rulesFor,
  setStatus,
  type PastorRow,
} from "@/lib/pastoral";
import {
  afterBooking,
  afterCancel,
  afterConfirm,
  afterDecline,
  afterReschedule,
} from "@/lib/pastoral-notify";
import { formatWhen, remindAtFor } from "@/lib/pastoral-messages";
import {
  HOLDING_STATUSES,
  MAX_SLOT_WINDOW_DAYS,
  churchZone,
  splitName,
  validateBooker,
  validateWeeklyHours,
  type AppointmentStatus,
  type Msg,
  type WeeklyWindow,
} from "@/lib/pastoral-shared";
import { addDaysToKey, fitsHours, todayKey, type Slot } from "@/lib/pastoral-slots";
import { hashToken, memberTicketSecret, newManageToken } from "@/lib/pastoral-tokens";

/**
 * Staff actions for pastoral appointments.
 *
 * Every one goes through `guard`: signed in to a church, the plan includes
 * the module (writes are refused off-plan, reads always work), and the
 * permission. "Own or manage" means the pastor concerned, or whoever holds
 * pastoral.manage. Every write is audited, and no audit line, notification
 * or message ever names what an appointment is about.
 */

export type Result<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; taken?: boolean };

type Church = Awaited<ReturnType<typeof requireChurch>>["church"];
type Guard =
  | { allowed: true; church: Church; user: { id: string; name: string }; t: TFunction }
  | { allowed: false; bad: { ok: false; error: string } };

async function guard(need: "pastoral.view" | "pastoral.manage"): Promise<Guard> {
  const { church, user } = await requireChurch();
  const t = await getT();
  const gate = await refuseWithoutFeature("pastoralBooking");
  if (gate) return { allowed: false, bad: { ok: false, error: gate.error } };
  if (!(await can(need))) return { allowed: false, bad: { ok: false, error: t("common.noPermission") } };
  return { allowed: true, church, user, t };
}

function refresh() {
  revalidatePath("/appointments");
}

const say = (t: TFunction, m: Msg) => t(m.key, m.vars);

/** The pastor, if this person is them or manages every diary. */
async function ownOrManage(
  g: Extract<Guard, { allowed: true }>,
  pastorId: string,
): Promise<{ ok: true; pastor: PastorRow } | { ok: false; error: string }> {
  const pastor = await getPastor(g.church.id, pastorId);
  if (!pastor) return { ok: false, error: g.t("pastoral.errors.pastorGone") };
  if (pastor.userId !== g.user.id && !(await can("pastoral.manage")))
    return { ok: false, error: g.t("pastoral.errors.notYours") };
  return { ok: true, pastor };
}

const zoneOf = (c: Church) => churchZone(c);
const whenText = (c: Church, at: Date) => formatWhen(at, zoneOf(c), "en-GB");

const uuid = z.string().uuid();
const formError = (t: TFunction) => ({ ok: false as const, error: t("pastoral.errors.form") });

/* ------------------------------------------------------------------ *
 * Pastors
 * ------------------------------------------------------------------ */

const rulesSchema = z.object({
  slotMinutes: z.coerce.number().int().min(10).max(240),
  bufferMinutes: z.coerce.number().int().min(0).max(240),
  minNoticeHours: z.coerce.number().int().min(0).max(720),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
});

const pastorSchema = rulesSchema.extend({
  userId: z.string().min(1).max(200),
  displayName: z.string().trim().min(2).max(80),
  title: z.string().trim().max(60).nullish(),
  isBookable: z.boolean().optional(),
  typeIds: z.array(uuid).max(50).optional(),
});

export type PastorInput = z.input<typeof pastorSchema>;

async function validTypeIds(churchId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const mine = new Set((await listTypes(churchId)).map((t) => t.id));
  return [...new Set(ids)].filter((id) => mine.has(id));
}

/** Add or edit a pastor [manage]. The login must be on this church's team. */
export async function savePastor(
  input: PastorInput,
  id?: string,
): Promise<Result<{ id: string; warnNoAccess: string | null }>> {
  const g = await guard("pastoral.manage");
  if (!g.allowed) return g.bad;
  const parsed = pastorSchema.safeParse(input);
  if (!parsed.success) return formError(g.t);
  const d = parsed.data;

  const existing = id ? await getPastor(g.church.id, id) : null;
  if (id && !existing) return { ok: false, error: g.t("pastoral.errors.pastorGone") };
  const userId = existing?.userId ?? d.userId;
  if (!(await isOnTeam(g.church.id, userId))) return { ok: false, error: g.t("pastoral.errors.notOnTeam") };
  const typeIds = await validTypeIds(g.church.id, d.typeIds ?? []);

  const values = {
    displayName: d.displayName,
    title: d.title?.trim() || null,
    isBookable: d.isBookable ?? true,
    slotMinutes: d.slotMinutes,
    bufferMinutes: d.bufferMinutes,
    minNoticeHours: d.minNoticeHours,
    maxAdvanceDays: d.maxAdvanceDays,
  };

  let pastorId: string;
  try {
    pastorId = await db.transaction(async (tx) => {
      let pid: string;
      if (existing) {
        await tx
          .update(pastorProfile)
          .set(values)
          .where(and(eq(pastorProfile.id, existing.id), eq(pastorProfile.churchId, g.church.id)));
        pid = existing.id;
      } else {
        const [row] = await tx
          .insert(pastorProfile)
          .values({ ...values, churchId: g.church.id, userId, createdBy: g.user.id })
          .returning({ id: pastorProfile.id });
        pid = row.id;
      }
      // The join rows are replaced whole, in the same transaction.
      await tx
        .delete(pastorBookingType)
        .where(and(eq(pastorBookingType.churchId, g.church.id), eq(pastorBookingType.pastorId, pid)));
      if (typeIds.length)
        await tx
          .insert(pastorBookingType)
          .values(typeIds.map((typeId) => ({ churchId: g.church.id, pastorId: pid, typeId })));
      return pid;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: g.t("pastoral.errors.alreadyPastor") };
    throw e;
  }

  await audit({
    churchId: g.church.id,
    action: existing ? "pastoral.pastor.update" : "pastoral.pastor.create",
    summary: existing ? `Updated the pastor ${d.displayName}` : `Added ${d.displayName} as a pastor`,
    targetType: "pastor_profile",
    targetId: pastorId,
    targetLabel: d.displayName,
  });

  /*
   * A pastor whose role does not include the module cannot open their own
   * diary. Custom roles were frozen when they were made, so this is the
   * common case for a role written before the module existed. Said in words.
   */
  const access = await loadStaffAccess(userId, g.church.id);
  refresh();
  return {
    ok: true,
    id: pastorId,
    warnNoAccess: accessHas(access, "pastoral.view") ? null : d.displayName,
  };
}

/** Take a pastor off the booking page, or put them back [manage]. Retire, not delete. */
export async function setPastorBookable(
  id: string,
  isBookable: boolean,
): Promise<Result<{ untouched: number }>> {
  const g = await guard("pastoral.manage");
  if (!g.allowed) return g.bad;
  const pastor = await getPastor(g.church.id, id);
  if (!pastor) return { ok: false, error: g.t("pastoral.errors.pastorGone") };

  await db
    .update(pastorProfile)
    .set({ isBookable })
    .where(and(eq(pastorProfile.id, id), eq(pastorProfile.churchId, g.church.id)));
  const upcoming = await listAppointments(g.church.id, {
    pastorId: id,
    from: new Date(),
    statuses: [...HOLDING_STATUSES],
    limit: 1000,
  });
  await audit({
    churchId: g.church.id,
    action: "pastoral.pastor.update",
    summary: `${isBookable ? "Put" : "Took"} ${pastor.displayName} ${isBookable ? "back on" : "off"} the booking page`,
    targetType: "pastor_profile",
    targetId: id,
    targetLabel: pastor.displayName,
  });
  refresh();
  return { ok: true, untouched: upcoming.length };
}

/** Slot length, buffer, notice and horizon [own or manage]. */
export async function savePastorRules(
  pastorId: string,
  input: z.input<typeof rulesSchema>,
): Promise<Result> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const own = await ownOrManage(g, pastorId);
  if (!own.ok) return own;
  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return formError(g.t);

  await db
    .update(pastorProfile)
    .set(parsed.data)
    .where(and(eq(pastorProfile.id, pastorId), eq(pastorProfile.churchId, g.church.id)));
  await audit({
    churchId: g.church.id,
    action: "pastoral.pastor.update",
    summary: `Changed the booking rules for ${own.pastor.displayName}`,
    targetType: "pastor_profile",
    targetId: pastorId,
    targetLabel: own.pastor.displayName,
  });
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Hours and days away
 * ------------------------------------------------------------------ */

const windowSchema = z.object({
  weekday: z.number().int(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
});

/**
 * Replace a pastor's weekly hours [own or manage]. Existing appointments are
 * never changed; the count of upcoming ones now outside the hours comes back
 * so the diary can say so.
 */
export async function saveHours(
  pastorId: string,
  windows: WeeklyWindow[],
): Promise<Result<{ outside: number }>> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const own = await ownOrManage(g, pastorId);
  if (!own.ok) return own;
  const parsed = z.array(windowSchema).max(42).safeParse(windows);
  if (!parsed.success) return formError(g.t);
  const checked = validateWeeklyHours(parsed.data, weekdayNames(g.t.locale));
  if (!checked.ok) return { ok: false, error: say(g.t, checked.error) };

  await db.transaction(async (tx) => {
    await tx
      .delete(pastorHours)
      .where(and(eq(pastorHours.churchId, g.church.id), eq(pastorHours.pastorId, pastorId)));
    if (checked.value.length)
      await tx
        .insert(pastorHours)
        .values(checked.value.map((w) => ({ ...w, churchId: g.church.id, pastorId })));
  });

  const upcoming = await listAppointments(g.church.id, {
    pastorId,
    from: new Date(),
    statuses: [...HOLDING_STATUSES],
    limit: 1000,
  });
  const zone = zoneOf(g.church);
  const outside = upcoming.filter((r) => !fitsHours(r.a.startsAt, r.a.endsAt, checked.value, zone)).length;

  await audit({
    churchId: g.church.id,
    action: "pastoral.hours.update",
    summary: `Changed the working hours of ${own.pastor.displayName}`,
    targetType: "pastor_profile",
    targetId: pastorId,
    targetLabel: own.pastor.displayName,
  });
  refresh();
  return { ok: true, outside };
}

const KINDS = ["leave", "travel", "conference", "sick", "other"] as const;

const closureSchema = z.object({
  kind: z.enum(KINDS),
  reason: z.string().trim().min(2).max(200),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  fromDay: z.string().optional(),
  toDay: z.string().optional(),
});

export type ClosureInput = z.input<typeof closureSchema>;

/**
 * Days away [own or manage]. Whole days become [local midnight of the first
 * day, local midnight after the last), in the church's zone. Taken under the
 * pastor's booking lock, so a booking cannot land inside it mid-write.
 * Appointments already in that time are listed, never cancelled for them.
 */
export async function addClosure(
  pastorId: string,
  input: ClosureInput,
): Promise<Result<{ overlapping: number }>> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const own = await ownOrManage(g, pastorId);
  if (!own.ok) return own;
  const parsed = closureSchema.safeParse(input);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.some((i) => i.path[0] === "reason");
    return { ok: false, error: g.t(reasonIssue ? "pastoral.errors.closureReason" : "pastoral.errors.form") };
  }
  const d = parsed.data;
  const zone = zoneOf(g.church);

  let startsAt: Date;
  let endsAt: Date;
  if (d.fromDay && d.toDay) {
    if (!isRealCalendarDate(d.fromDay) || !isRealCalendarDate(d.toDay))
      return { ok: false, error: g.t("pastoral.errors.closureDays") };
    const [fy, fm, fd] = d.fromDay.split("-").map(Number);
    const [ty, tm, td] = addDaysToKey(d.toDay, 1).split("-").map(Number);
    startsAt = instantFromWallClock({ year: fy, month: fm, day: fd, hour: 0, minute: 0 }, zone);
    endsAt = instantFromWallClock({ year: ty, month: tm, day: td, hour: 0, minute: 0 }, zone);
  } else {
    startsAt = new Date(d.startsAt ?? "");
    endsAt = new Date(d.endsAt ?? "");
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
      return { ok: false, error: g.t("pastoral.errors.closureDays") };
  }
  if (endsAt.getTime() <= startsAt.getTime()) return { ok: false, error: g.t("pastoral.errors.closureRange") };
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000)
    return { ok: false, error: g.t("pastoral.errors.closureTooLong") };

  const result = await db.transaction(async (tx) => {
    if (!(await lockPastorForBooking(tx, g.church.id, pastorId))) return null;
    const [row] = await tx
      .insert(pastorClosure)
      .values({ churchId: g.church.id, pastorId, kind: d.kind, reason: d.reason, startsAt, endsAt, createdBy: g.user.id })
      .returning({ id: pastorClosure.id });
    const busy = await busyFor(tx, g.church.id, pastorId, startsAt, endsAt);
    const overlapping = busy.appointments.filter(
      (a) => new Date(a.startsAt).getTime() < endsAt.getTime() && new Date(a.endsAt).getTime() > startsAt.getTime(),
    ).length;
    return { id: row.id, overlapping };
  });
  if (!result) return { ok: false, error: g.t("pastoral.errors.pastorGone") };

  await audit({
    churchId: g.church.id,
    action: "pastoral.closure.create",
    summary: `Marked ${own.pastor.displayName} away from ${whenText(g.church, startsAt)} to ${whenText(g.church, endsAt)}`,
    targetType: "pastor_closure",
    targetId: result.id,
    targetLabel: own.pastor.displayName,
  });
  refresh();
  return { ok: true, overlapping: result.overlapping };
}

export async function removeClosure(id: string): Promise<Result> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  if (!uuid.safeParse(id).success) return formError(g.t);
  const [closure] = await db
    .select({ pastorId: pastorClosure.pastorId, startsAt: pastorClosure.startsAt })
    .from(pastorClosure)
    .where(and(eq(pastorClosure.id, id), eq(pastorClosure.churchId, g.church.id)))
    .limit(1);
  if (!closure) return { ok: false, error: g.t("pastoral.errors.closureGone") };
  const own = await ownOrManage(g, closure.pastorId);
  if (!own.ok) return own;

  await db
    .delete(pastorClosure)
    .where(
      and(
        eq(pastorClosure.id, id),
        eq(pastorClosure.churchId, g.church.id),
        eq(pastorClosure.pastorId, closure.pastorId),
      ),
    );
  await audit({
    churchId: g.church.id,
    action: "pastoral.closure.remove",
    summary: `Removed days away for ${own.pastor.displayName} (from ${whenText(g.church, closure.startsAt)})`,
    targetType: "pastor_closure",
    targetId: id,
    targetLabel: own.pastor.displayName,
  });
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Booking types
 * ------------------------------------------------------------------ */

const LOCATIONS = ["church", "home", "phone", "online"] as const;

const typeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullish(),
  durationMinutes: z.coerce.number().int().min(10).max(480).nullish(),
  location: z.enum(LOCATIONS),
  requiresApproval: z.boolean().optional(),
  pastorIds: z.array(uuid).max(100).optional(),
});

export type BookingTypeInput = z.input<typeof typeSchema>;

/** Add or edit a booking type, and who offers it [manage]. */
export async function saveBookingType(
  input: BookingTypeInput,
  id?: string,
): Promise<Result<{ id: string }>> {
  const g = await guard("pastoral.manage");
  if (!g.allowed) return g.bad;
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return formError(g.t);
  const d = parsed.data;
  if (id && !(await getType(g.church.id, id))) return { ok: false, error: g.t("pastoral.errors.typeGone") };

  const pastors = d.pastorIds
    ? (
        await db
          .select({ id: pastorProfile.id })
          .from(pastorProfile)
          .where(and(eq(pastorProfile.churchId, g.church.id), inArray(pastorProfile.id, d.pastorIds.length ? d.pastorIds : ["00000000-0000-0000-0000-000000000000"])))
      ).map((p) => p.id)
    : null;

  const values = {
    name: d.name,
    description: d.description?.trim() || null,
    durationMinutes: d.durationMinutes ?? null,
    location: d.location,
    requiresApproval: d.requiresApproval ?? false,
  };

  let typeId: string;
  try {
    typeId = await db.transaction(async (tx) => {
      let tid: string;
      if (id) {
        await tx
          .update(pastoralBookingType)
          .set(values)
          .where(and(eq(pastoralBookingType.id, id), eq(pastoralBookingType.churchId, g.church.id)));
        tid = id;
      } else {
        const [row] = await tx
          .insert(pastoralBookingType)
          .values({ ...values, churchId: g.church.id, createdBy: g.user.id })
          .returning({ id: pastoralBookingType.id });
        tid = row.id;
      }
      if (pastors) {
        await tx
          .delete(pastorBookingType)
          .where(and(eq(pastorBookingType.churchId, g.church.id), eq(pastorBookingType.typeId, tid)));
        if (pastors.length)
          await tx
            .insert(pastorBookingType)
            .values(pastors.map((pastorId) => ({ churchId: g.church.id, pastorId, typeId: tid })));
      }
      return tid;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: g.t("pastoral.errors.typeNameTaken", { name: d.name }) };
    throw e;
  }

  await audit({
    churchId: g.church.id,
    action: id ? "pastoral.type.update" : "pastoral.type.create",
    summary: id ? `Updated the booking type ${d.name}` : `Added the booking type ${d.name}`,
    targetType: "pastoral_booking_type",
    targetId: typeId,
    targetLabel: d.name,
  });
  refresh();
  return { ok: true, id: typeId };
}

/** Retire or bring back a type [manage]. Old appointments still name it. */
export async function setBookingTypeActive(id: string, isActive: boolean): Promise<Result> {
  const g = await guard("pastoral.manage");
  if (!g.allowed) return g.bad;
  const type = await getType(g.church.id, id);
  if (!type) return { ok: false, error: g.t("pastoral.errors.typeGone") };
  await db
    .update(pastoralBookingType)
    .set({ isActive })
    .where(and(eq(pastoralBookingType.id, id), eq(pastoralBookingType.churchId, g.church.id)));
  await audit({
    churchId: g.church.id,
    action: "pastoral.type.update",
    summary: `${isActive ? "Brought back" : "Retired"} the booking type ${type.name}`,
    targetType: "pastoral_booking_type",
    targetId: id,
    targetLabel: type.name,
  });
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * The booking page
 * ------------------------------------------------------------------ */

const pageSchema = z.object({
  enabled: z.boolean(),
  visibility: z.enum(["public", "members"]),
  title: z.string().trim().min(2).max(120),
  intro: z.string().trim().max(1000),
  emailBooker: z.boolean(),
  smsBooker: z.boolean(),
  notifyPastorByEmail: z.boolean(),
  reminderLeadMinutes: z.coerce.number().int().min(60).max(4320),
  changeCutoffHours: z.coerce.number().int().min(0).max(168),
  maxUpcomingPerContact: z.coerce.number().int().min(1).max(10),
});

export type BookingPageInput = z.input<typeof pageSchema>;

export async function saveBookingPage(input: BookingPageInput): Promise<Result> {
  const g = await guard("pastoral.manage");
  if (!g.allowed) return g.bad;
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return formError(g.t);
  // Members-only needs the signing secret; with none it could never verify anyone.
  if (parsed.data.visibility === "members" && !memberTicketSecret())
    return { ok: false, error: g.t("pastoral.page.secretMissing") };

  await ensureBookingPage({ id: g.church.id, name: g.church.name, handle: g.church.handle });
  await db
    .update(pastoralBookingPage)
    .set(parsed.data)
    .where(eq(pastoralBookingPage.churchId, g.church.id));
  await audit({
    churchId: g.church.id,
    action: "pastoral.page.update",
    summary: `Updated the pastor booking page (${parsed.data.enabled ? "on" : "off"}, ${parsed.data.visibility})`,
    targetType: "pastoral_booking_page",
    targetId: g.church.id,
  });
  refresh();
  return { ok: true };
}

/** A new link, which stops the old one and every printed QR code [manage]. */
export async function regenerateBookingSlug(): Promise<Result<{ slug: string }>> {
  const g = await guard("pastoral.manage");
  if (!g.allowed) return g.bad;
  await ensureBookingPage({ id: g.church.id, name: g.church.name, handle: g.church.handle });
  const slug = await regenerateSlug(g.church.id, g.church.handle || g.church.name);
  await audit({
    churchId: g.church.id,
    action: "pastoral.page.update",
    summary: "Issued a new pastor booking link; the old one no longer works",
    targetType: "pastoral_booking_page",
    targetId: g.church.id,
    severity: "warning",
  });
  refresh();
  return { ok: true, slug };
}

/* ------------------------------------------------------------------ *
 * Slots for staff
 * ------------------------------------------------------------------ */

export type StaffSlots = { zone: string; slots: Slot[]; nextFromDay: string };

/**
 * Open times for a pastor, read-only [view], at most 14 days. With
 * `appointmentId` the slots are for moving it: its own length, and its own
 * time not counted against it.
 */
export async function listSlotsForStaff(
  pastorId: string,
  typeId: string | null,
  fromDay: string,
  appointmentId?: string,
): Promise<Result<StaffSlots>> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const pastor = await getPastor(g.church.id, pastorId);
  if (!pastor) return { ok: false, error: g.t("pastoral.errors.pastorGone") };
  const zone = zoneOf(g.church);
  const day = isRealCalendarDate(fromDay) ? fromDay : todayKey(new Date(), zone);

  let duration: { durationMinutes: number | null } = { durationMinutes: null };
  if (appointmentId) {
    const appt = await getAppointment(g.church.id, appointmentId);
    if (!appt) return { ok: false, error: g.t("pastoral.errors.appointmentGone") };
    duration = { durationMinutes: Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000) };
  } else if (typeId) {
    const type = await getType(g.church.id, typeId);
    if (!type) return { ok: false, error: g.t("pastoral.errors.typeGone") };
    duration = type;
  }

  const rules = rulesFor(pastor, await hoursOf(g.church.id, pastorId), duration, zone, { staff: true });
  const slots = await openSlots({
    churchId: g.church.id,
    pastorId,
    rules,
    fromDay: day,
    days: MAX_SLOT_WINDOW_DAYS,
    now: new Date(),
    ignoreId: appointmentId,
  });
  return { ok: true, zone, slots, nextFromDay: addDaysToKey(day, MAX_SLOT_WINDOW_DAYS) };
}

/* ------------------------------------------------------------------ *
 * Booking for somebody
 * ------------------------------------------------------------------ */

const behalfSchema = z.object({
  pastorId: uuid,
  typeId: uuid,
  startsAt: z.string().min(10).max(40),
  memberId: uuid.nullish(),
  name: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().max(200).nullish(),
  address: z.string().max(400).nullish(),
  topic: z.string().max(2000).nullish(),
  allowOutsideHours: z.boolean().optional(),
  sendConfirmation: z.boolean().optional(),
});

export type BookOnBehalfInput = z.input<typeof behalfSchema>;

export async function bookOnBehalf(input: BookOnBehalfInput): Promise<Result<{ id: string }>> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const parsed = behalfSchema.safeParse(input);
  if (!parsed.success) return formError(g.t);
  const d = parsed.data;
  // Checked before anything reads it: remindAtFor formats the instant in the
  // church's zone, and Intl throws on an invalid date, which would surface as
  // a crash instead of "that time is not available".
  const startsAtDate = new Date(d.startsAt);
  if (Number.isNaN(startsAtDate.getTime())) return formError(g.t);

  const pastor = await getPastor(g.church.id, d.pastorId);
  if (!pastor) return { ok: false, error: g.t("pastoral.errors.pastorGone") };
  const type = await getType(g.church.id, d.typeId);
  if (!type || !type.isActive) return { ok: false, error: g.t("pastoral.errors.typeGone") };
  if (!(await pastorOffersType(g.church.id, pastor.id, type.id)))
    return { ok: false, error: g.t("pastoral.errors.notOffered", { pastor: pastor.displayName, type: type.name }) };

  // "Ignore working hours" is a manager's override, never a viewer's.
  const allowOutsideHours = !!d.allowOutsideHours && (await can("pastoral.manage"));

  let memberId: string | null = null;
  let booker: { name: string; phone: string | null; email: string | null };
  const dial = await churchDial(g.church.id);
  if (d.memberId) {
    const [m] = await db
      .select({ id: member.id, firstName: member.firstName, lastName: member.lastName, phone: member.phone, email: member.email })
      .from(member)
      .where(and(eq(member.id, d.memberId), eq(member.churchId, g.church.id)))
      .limit(1);
    if (!m) return { ok: false, error: g.t("pastoral.errors.memberGone") };
    memberId = m.id;
    const fromRegister = validateBooker(
      { name: [m.firstName, m.lastName].filter(Boolean).join(" "), phone: m.phone, email: m.email },
      { location: "church", needContact: false, dial },
    );
    // A register entry with a malformed phone or email still books; the
    // unusable contact is simply not copied.
    booker = fromRegister.ok
      ? fromRegister.value
      : { name: [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member", phone: null, email: null };
  } else {
    const typed = validateBooker(
      { name: d.name, phone: d.phone, email: d.email },
      { location: "church", needContact: false, dial },
    );
    if (!typed.ok) return { ok: false, error: say(g.t, typed.error) };
    booker = typed.value;
  }
  const extra = validateBooker(
    { name: booker.name, address: d.address, topic: d.topic },
    { location: type.location, needContact: false, dial },
  );
  if (!extra.ok) return { ok: false, error: say(g.t, extra.error) };

  const zone = zoneOf(g.church);
  const rules = rulesFor(pastor, await hoursOf(g.church.id, pastor.id), type, zone, { staff: true });
  const page = await ensureBookingPage({ id: g.church.id, name: g.church.name, handle: g.church.handle });
  const token = newManageToken();
  const now = new Date();
  const claim = await claimAppointment({
    churchId: g.church.id,
    pastorId: pastor.id,
    rules,
    startsAt: d.startsAt,
    now,
    allowOutsideHours,
    values: {
      pastorName: pastor.displayName,
      typeId: type.id,
      typeName: type.name,
      location: type.location,
      address: extra.value.address,
      status: "confirmed",
      source: "staff",
      memberId,
      identityVerified: !!memberId,
      bookerName: booker.name,
      bookerPhone: booker.phone,
      bookerEmail: booker.email,
      locale: null,
      topic: extra.value.topic,
      manageTokenHash: hashToken(token),
      createdBy: g.user.id,
      decidedBy: g.user.id,
      decidedAt: now,
      remindAt: remindAtFor(startsAtDate, page.reminderLeadMinutes, zone, now),
    },
  });
  if (!claim.ok)
    return claim.reason === "missing"
      ? { ok: false, error: g.t("pastoral.errors.pastorGone") }
      : { ok: false, error: g.t("pastoral.public.taken"), taken: true };

  await afterBooking(g.church.id, claim.id, {
    token,
    toBooker: d.sendConfirmation !== false,
    now,
    actorUserId: g.user.id,
  });
  await audit({
    churchId: g.church.id,
    action: "pastoral.appointment.create",
    summary: `Booked ${type.name} with ${pastor.displayName} for ${whenText(g.church, new Date(claim.slot.startsAt))}`,
    targetType: "pastoral_appointment",
    targetId: claim.id,
  });
  refresh();
  return { ok: true, id: claim.id };
}

/* ------------------------------------------------------------------ *
 * Deciding, cancelling, moving
 * ------------------------------------------------------------------ */

async function apptForAction(g: Extract<Guard, { allowed: true }>, id: string) {
  if (!uuid.safeParse(id).success) return { ok: false as const, error: g.t("pastoral.errors.appointmentGone") };
  const appt = await getAppointment(g.church.id, id);
  if (!appt) return { ok: false as const, error: g.t("pastoral.errors.appointmentGone") };
  if (!appt.pastorId) {
    if (!(await can("pastoral.manage"))) return { ok: false as const, error: g.t("pastoral.errors.notYours") };
    return { ok: true as const, appt, pastor: null };
  }
  const own = await ownOrManage(g, appt.pastorId);
  if (!own.ok) return own;
  return { ok: true as const, appt, pastor: own.pastor };
}

export async function confirmAppointment(id: string): Promise<Result> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const found = await apptForAction(g, id);
  if (!found.ok) return found;
  const page = await ensureBookingPage({ id: g.church.id, name: g.church.name, handle: g.church.handle });
  const now = new Date();
  const row = await setStatus({
    id,
    churchId: g.church.id,
    from: ["pending"],
    to: "confirmed",
    patch: {
      decidedBy: g.user.id,
      decidedAt: now,
      remindAt: remindAtFor(found.appt.startsAt, page.reminderLeadMinutes, zoneOf(g.church), now),
    },
    // The reminder above was worked out from the time read here. If the
    // booker moved it in between, confirming would file a reminder for the
    // old time, so the start is repeated and a moved appointment is refused.
    expectStartsAt: found.appt.startsAt,
  });
  if (!row) return { ok: false, error: g.t("pastoral.errors.notWaiting") };
  await afterConfirm(g.church.id, id, now);
  await audit({
    churchId: g.church.id,
    action: "pastoral.appointment.confirm",
    summary: `Confirmed ${row.typeName} with ${row.pastorName} for ${whenText(g.church, row.startsAt)}`,
    targetType: "pastoral_appointment",
    targetId: id,
  });
  refresh();
  return { ok: true };
}

export async function declineAppointment(id: string, note: string): Promise<Result> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const clean = (note ?? "").trim();
  if (clean.length < 2 || clean.length > 500) return { ok: false, error: g.t("pastoral.errors.declineNote") };
  const found = await apptForAction(g, id);
  if (!found.ok) return found;
  const row = await setStatus({
    id,
    churchId: g.church.id,
    from: ["pending"],
    to: "declined",
    patch: { decidedBy: g.user.id, decidedAt: new Date(), decisionNote: clean, remindAt: null },
  });
  if (!row) return { ok: false, error: g.t("pastoral.errors.notWaiting") };
  await afterDecline(g.church.id, id);
  await audit({
    churchId: g.church.id,
    action: "pastoral.appointment.decline",
    summary: `Declined ${row.typeName} with ${row.pastorName} for ${whenText(g.church, row.startsAt)}`,
    targetType: "pastoral_appointment",
    targetId: id,
  });
  refresh();
  return { ok: true };
}

export async function cancelAppointment(id: string, note?: string): Promise<Result> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const clean = (note ?? "").trim().slice(0, 500) || null;
  const found = await apptForAction(g, id);
  if (!found.ok) return found;
  const row = await setStatus({
    id,
    churchId: g.church.id,
    from: [...HOLDING_STATUSES] as AppointmentStatus[],
    to: "cancelled",
    // The hash is kept, so the booker's link shows "cancelled" rather than nothing.
    patch: { cancelledBy: "staff", cancelledAt: new Date(), decisionNote: clean, remindAt: null },
  });
  if (!row) return { ok: false, error: g.t("pastoral.errors.notActive") };
  await afterCancel(g.church.id, id, "staff", { actorUserId: g.user.id });
  await audit({
    churchId: g.church.id,
    action: "pastoral.appointment.cancel",
    summary: `Cancelled ${row.typeName} with ${row.pastorName} for ${whenText(g.church, row.startsAt)}`,
    targetType: "pastoral_appointment",
    targetId: id,
  });
  refresh();
  return { ok: true };
}

/** Move to another time [own or manage]. Stays confirmed: staff chose the time. */
export async function rescheduleAppointment(
  id: string,
  startsAt: string,
  allowOutsideHoursRequested?: boolean,
): Promise<Result> {
  const g = await guard("pastoral.view");
  if (!g.allowed) return g.bad;
  const found = await apptForAction(g, id);
  if (!found.ok) return found;
  if (!found.pastor) return { ok: false, error: g.t("pastoral.errors.pastorGone") };
  const allowOutsideHours = !!allowOutsideHoursRequested && (await can("pastoral.manage"));

  const appt = found.appt;
  const zone = zoneOf(g.church);
  const rules = rulesFor(
    found.pastor,
    await hoursOf(g.church.id, found.pastor.id),
    { durationMinutes: Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000) },
    zone,
    { staff: true },
  );
  const page = await ensureBookingPage({ id: g.church.id, name: g.church.name, handle: g.church.handle });
  const token = newManageToken();
  const now = new Date();
  const moved = await moveAppointment({
    id,
    churchId: g.church.id,
    pastorId: found.pastor.id,
    rules,
    expectStartsAt: appt.startsAt,
    newStartsAt: startsAt,
    now,
    allowOutsideHours,
    newTokenHash: hashToken(token),
    newStatus: "confirmed",
    remindAt: (slot) => remindAtFor(new Date(slot.startsAt), page.reminderLeadMinutes, zone, now),
  });
  if (!moved.ok) {
    if (moved.reason === "taken") return { ok: false, error: g.t("pastoral.public.taken"), taken: true };
    if (moved.reason === "missing") return { ok: false, error: g.t("pastoral.errors.pastorGone") };
    return { ok: false, error: g.t("pastoral.manage.changed") };
  }
  await afterReschedule(g.church.id, id, { token, toBooker: true, now, actorUserId: g.user.id });
  await audit({
    churchId: g.church.id,
    action: "pastoral.appointment.reschedule",
    summary: `Moved ${appt.typeName} with ${appt.pastorName} from ${whenText(g.church, appt.startsAt)} to ${whenText(g.church, new Date(moved.slot.startsAt))}`,
    targetType: "pastoral_appointment",
    targetId: id,
  });
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Onto the register
 * ------------------------------------------------------------------ */

/**
 * Put a booker who is not on the register into it as a first-timer, through
 * registerFirstTimer, the only function that writes one (AGENTS.md). A phone
 * or email already on the register links that person instead, so this can
 * never make a duplicate. Needs Follow-up on the plan and followup.manage.
 */
export async function addBookerToRegister(
  id: string,
): Promise<Result<{ outcome: "created" | "matched"; message: string }>> {
  const { church, user } = await requireChurch();
  const t = await getT();
  if (!(await hasFeature("pastoralBooking")) || !(await hasFeature("followUp"))) {
    const gate = (await refuseWithoutFeature("followUp")) ?? (await refuseWithoutFeature("pastoralBooking"));
    if (gate) return { ok: false, error: gate.error };
  }
  if (!(await can("pastoral.view")) || !(await can("followup.manage")))
    return { ok: false, error: t("common.noPermission") };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("pastoral.errors.appointmentGone") };

  const appt = await getAppointment(church.id, id);
  if (!appt) return { ok: false, error: t("pastoral.errors.appointmentGone") };
  if (appt.memberId) return { ok: false, error: t("pastoral.errors.alreadyLinked") };

  const { firstName, lastName } = splitName(appt.bookerName);
  const res = await registerFirstTimer({
    churchId: church.id,
    intake: {
      firstName,
      lastName,
      phone: appt.bookerPhone,
      email: appt.bookerEmail,
      address: appt.address,
    },
    createdBy: user.id,
    enforceMemberLimit: true,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // Only while still unlinked: two people pressing at once must not let the
  // second overwrite a link the first has just made.
  await db
    .update(pastoralAppointment)
    .set({ memberId: res.result.memberId, identityVerified: true })
    .where(
      and(
        eq(pastoralAppointment.id, id),
        eq(pastoralAppointment.churchId, church.id),
        isNull(pastoralAppointment.memberId),
      ),
    );
  await audit({
    churchId: church.id,
    action: "pastoral.appointment.update",
    summary:
      res.result.outcome === "created"
        ? `Added ${appt.bookerName} to the register as a first-timer from a pastoral appointment`
        : `Linked a pastoral appointment to ${appt.bookerName}, already on the register`,
    targetType: "pastoral_appointment",
    targetId: id,
  });
  revalidatePath("/appointments");
  revalidatePath("/first-timers");
  revalidatePath("/follow-up");
  return {
    ok: true,
    outcome: res.result.outcome,
    message:
      res.result.outcome === "created"
        ? t("pastoral.done.registerCreated", { name: appt.bookerName })
        : t("pastoral.done.registerMatched", { name: appt.bookerName }),
  };
}
