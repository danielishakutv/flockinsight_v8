import "server-only";
import { rowHasFeature } from "@/lib/plan-catalog";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  member,
  pastorBookingType,
  pastorClosure,
  pastorHours,
  pastorProfile,
  pastoralAppointment,
  pastoralBookingPage,
  pastoralBookingType,
  staff,
  user,
} from "@/db/schema";
import { automationPaused, standingColumns } from "@/lib/church-standing";
import { isBookingOverlapViolation } from "@/lib/facilities";
import type { ClashCandidate } from "@/lib/facility-shared";
import { instantFromWallClock } from "@/lib/meeting-recurrence";
import {
  HOLDING_STATUSES,
  appointmentLength,
  type AppointmentStatus,
  type WeeklyWindow,
} from "@/lib/pastoral-shared";
import {
  buildSlot,
  generateSlots,
  isOfferedSlot,
  slotIsFree,
  type Busy,
  type Slot,
  type SlotRules,
} from "@/lib/pastoral-slots";
import { hashToken, looksLikeManageToken } from "@/lib/pastoral-tokens";
import { siteUrl } from "@/lib/site";
import { randomSuffix, slugify } from "@/lib/slug";

/**
 * Reading and writing pastoral appointments.
 *
 * Every read filters by church. Every join to `member` is scoped by church as
 * well as id, because member.id is global and an unscoped join is how one
 * church's member name prints on another church's page.
 *
 * The one thing here that is not a plain query is the claim
 * (`claimAppointment`, `moveAppointment`): lock the pastor row, re-check the
 * slot under the lock, write, and let the exclusion constraint refuse
 * anything that slipped past. READ COMMITTED alone would let two people book
 * one slot (AGENTS.md, "db.transaction is not isolation").
 */

const DAY_MS = 86_400_000;

/** `db`, or the transaction a caller is already inside. */
type Executor = Pick<typeof db, "select">;

export type PastorRow = typeof pastorProfile.$inferSelect;
export type TypeRow = typeof pastoralBookingType.$inferSelect;
export type AppointmentRow = typeof pastoralAppointment.$inferSelect;
export type BookingPageRow = typeof pastoralBookingPage.$inferSelect;
type NewAppointment = typeof pastoralAppointment.$inferInsert;

const holding = HOLDING_STATUSES as unknown as AppointmentStatus[];

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

export function bookingPath(slug: string): string {
  return `/book/${slug}`;
}
export function bookingUrl(slug: string): string {
  return `${siteUrl()}${bookingPath(slug)}`;
}
export function managePath(token: string): string {
  return `/appointment/${token}`;
}
export function manageUrl(token: string): string {
  return `${siteUrl()}${managePath(token)}`;
}

/* ------------------------------------------------------------------ *
 * Pastors, hours, closures, types
 * ------------------------------------------------------------------ */

export type PastorWithTeam = PastorRow & {
  /** Still a genuine (non-temp) member of the team. */
  onTeam: boolean;
  typeIds: string[];
  userName: string | null;
  userEmail: string | null;
};

/**
 * The church's pastors, each marked with whether their login is still on the
 * team.
 *
 * Two queries, not a join: `staff` has no unique (organization, user) index,
 * so joining it could return one pastor twice. A removed login simply drops
 * off the booking page; their history stays.
 */
export async function listPastors(
  churchId: string,
  opts: { bookableOnly?: boolean } = {},
): Promise<PastorWithTeam[]> {
  const rows = await db
    .select({ p: pastorProfile, userName: user.name, userEmail: user.email })
    .from(pastorProfile)
    .leftJoin(user, eq(user.id, pastorProfile.userId))
    .where(eq(pastorProfile.churchId, churchId))
    .orderBy(asc(pastorProfile.sortOrder), asc(pastorProfile.displayName));

  const team = await db
    .selectDistinct({ userId: staff.userId })
    .from(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.temp, false)));
  const onTeam = new Set(team.map((r) => r.userId));

  const ids = rows.map((r) => r.p.id);
  const links = ids.length
    ? await db
        .select({ pastorId: pastorBookingType.pastorId, typeId: pastorBookingType.typeId })
        .from(pastorBookingType)
        .where(and(eq(pastorBookingType.churchId, churchId), inArray(pastorBookingType.pastorId, ids)))
    : [];

  return rows
    .map((r) => ({
      ...r.p,
      onTeam: onTeam.has(r.p.userId),
      typeIds: links.filter((l) => l.pastorId === r.p.id).map((l) => l.typeId),
      userName: r.userName,
      userEmail: r.userEmail,
    }))
    .filter((p) => !opts.bookableOnly || (p.isBookable && p.onTeam));
}

export async function getPastor(churchId: string, id: string): Promise<PastorRow | null> {
  const [row] = await db
    .select()
    .from(pastorProfile)
    .where(and(eq(pastorProfile.id, id), eq(pastorProfile.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

/** Is this login a genuine member of this church's team? */
export async function isOnTeam(churchId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.userId, userId), eq(staff.temp, false)))
    .limit(1);
  return !!row;
}

export async function listHours(churchId: string, pastorIds: string[]) {
  if (!pastorIds.length) return [];
  return db
    .select({
      id: pastorHours.id,
      pastorId: pastorHours.pastorId,
      weekday: pastorHours.weekday,
      startMinute: pastorHours.startMinute,
      endMinute: pastorHours.endMinute,
    })
    .from(pastorHours)
    .where(and(eq(pastorHours.churchId, churchId), inArray(pastorHours.pastorId, pastorIds)))
    .orderBy(asc(pastorHours.weekday), asc(pastorHours.startMinute));
}

export async function hoursOf(churchId: string, pastorId: string): Promise<WeeklyWindow[]> {
  const rows = await listHours(churchId, [pastorId]);
  return rows.map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute }));
}

export async function listClosures(
  churchId: string,
  opts: { pastorId?: string; from?: Date; to?: Date } = {},
) {
  const where = [eq(pastorClosure.churchId, churchId)];
  if (opts.pastorId) where.push(eq(pastorClosure.pastorId, opts.pastorId));
  if (opts.to) where.push(lt(pastorClosure.startsAt, opts.to));
  if (opts.from) where.push(gt(pastorClosure.endsAt, opts.from));
  return db
    .select({
      id: pastorClosure.id,
      pastorId: pastorClosure.pastorId,
      kind: pastorClosure.kind,
      reason: pastorClosure.reason,
      startsAt: pastorClosure.startsAt,
      endsAt: pastorClosure.endsAt,
    })
    .from(pastorClosure)
    .where(and(...where))
    .orderBy(asc(pastorClosure.startsAt))
    .limit(1000);
}

export async function listTypes(churchId: string, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(pastoralBookingType)
    .where(
      and(
        eq(pastoralBookingType.churchId, churchId),
        opts.activeOnly ? eq(pastoralBookingType.isActive, true) : undefined,
      ),
    )
    .orderBy(asc(pastoralBookingType.sortOrder), asc(pastoralBookingType.name));
}

export async function getType(churchId: string, id: string): Promise<TypeRow | null> {
  const [row] = await db
    .select()
    .from(pastoralBookingType)
    .where(and(eq(pastoralBookingType.id, id), eq(pastoralBookingType.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

/** Explicit: no join row, not offered. */
export async function pastorOffersType(
  churchId: string,
  pastorId: string,
  typeId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ typeId: pastorBookingType.typeId })
    .from(pastorBookingType)
    .where(
      and(
        eq(pastorBookingType.churchId, churchId),
        eq(pastorBookingType.pastorId, pastorId),
        eq(pastorBookingType.typeId, typeId),
      ),
    )
    .limit(1);
  return !!row;
}

/* ------------------------------------------------------------------ *
 * Slots
 * ------------------------------------------------------------------ */

export function rulesFor(
  pastor: Pick<PastorRow, "slotMinutes" | "bufferMinutes" | "minNoticeHours" | "maxAdvanceDays">,
  hours: WeeklyWindow[],
  type: { durationMinutes: number | null },
  timeZone: string,
  opts: { staff?: boolean } = {},
): SlotRules {
  return {
    timeZone,
    hours,
    slotMinutes: pastor.slotMinutes,
    durationMinutes: appointmentLength(type, pastor),
    bufferMinutes: pastor.bufferMinutes,
    // Staff booking for somebody may book later today; the notice is there
    // to protect the pastor from strangers, not from their own office.
    minNoticeMinutes: opts.staff ? 0 : pastor.minNoticeHours * 60,
    // Staff may also look further ahead than the public horizon.
    maxAdvanceDays: opts.staff ? Math.max(pastor.maxAdvanceDays, 365) : pastor.maxAdvanceDays,
  };
}

/**
 * Everything standing in a pastor's way between two instants: appointments
 * that hold a slot (with `endsAt` = their holds_until, the constraint's
 * range) and closures. Padded by a day, which covers any buffer. Two
 * sequential reads, like clashesFor: in a transaction they share a connection.
 */
export async function busyFor(
  executor: Executor,
  churchId: string,
  pastorId: string,
  from: Date,
  to: Date,
  ignoreId?: string,
): Promise<Busy> {
  const lo = new Date(from.getTime() - DAY_MS);
  const hi = new Date(to.getTime() + DAY_MS);
  const appts = await executor
    .select({
      id: pastoralAppointment.id,
      typeName: pastoralAppointment.typeName,
      startsAt: pastoralAppointment.startsAt,
      holdsUntil: pastoralAppointment.holdsUntil,
    })
    .from(pastoralAppointment)
    .where(
      and(
        eq(pastoralAppointment.churchId, churchId),
        eq(pastoralAppointment.pastorId, pastorId),
        inArray(pastoralAppointment.status, holding),
        lt(pastoralAppointment.startsAt, hi),
        gt(pastoralAppointment.holdsUntil, lo),
        ignoreId ? ne(pastoralAppointment.id, ignoreId) : undefined,
      ),
    );
  const closures = await executor
    .select({
      id: pastorClosure.id,
      reason: pastorClosure.reason,
      startsAt: pastorClosure.startsAt,
      endsAt: pastorClosure.endsAt,
    })
    .from(pastorClosure)
    .where(
      and(
        eq(pastorClosure.churchId, churchId),
        eq(pastorClosure.pastorId, pastorId),
        lt(pastorClosure.startsAt, hi),
        gt(pastorClosure.endsAt, lo),
      ),
    );

  return {
    appointments: appts.map(
      (a): ClashCandidate => ({
        id: a.id,
        label: a.typeName,
        sort: "booking",
        startsAt: a.startsAt,
        endsAt: a.holdsUntil,
      }),
    ),
    closures: closures.map(
      (c): ClashCandidate => ({
        id: c.id,
        label: c.reason,
        sort: "closure",
        startsAt: c.startsAt,
        endsAt: c.endsAt,
      }),
    ),
  };
}

/** Local midnight of a "YYYY-MM-DD" in `timeZone`. */
export function localMidnight(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return instantFromWallClock({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

/** Open slots for one pastor and one length, over up to 14 local days. */
export async function openSlots(args: {
  churchId: string;
  pastorId: string;
  rules: SlotRules;
  fromDay: string;
  days: number;
  now: Date;
  ignoreId?: string;
}): Promise<Slot[]> {
  const from = localMidnight(args.fromDay, args.rules.timeZone);
  const to = new Date(from.getTime() + (args.days + 1) * DAY_MS);
  const busy = await busyFor(db, args.churchId, args.pastorId, from, to, args.ignoreId);
  return generateSlots(args.rules, busy, {
    now: args.now,
    fromDay: args.fromDay,
    days: args.days,
    ignoreId: args.ignoreId,
  });
}

/* ------------------------------------------------------------------ *
 * Appointments: reads
 * ------------------------------------------------------------------ */

export async function getAppointment(churchId: string, id: string): Promise<AppointmentRow | null> {
  const [row] = await db
    .select()
    .from(pastoralAppointment)
    .where(and(eq(pastoralAppointment.id, id), eq(pastoralAppointment.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

/** Appointments overlapping a window, with the linked member's name. */
export async function listAppointments(
  churchId: string,
  opts: {
    from?: Date;
    to?: Date;
    pastorId?: string;
    statuses?: AppointmentStatus[];
    limit?: number;
    order?: "asc" | "desc";
  } = {},
) {
  const where = [eq(pastoralAppointment.churchId, churchId)];
  if (opts.to) where.push(lt(pastoralAppointment.startsAt, opts.to));
  if (opts.from) where.push(gte(pastoralAppointment.endsAt, opts.from));
  if (opts.pastorId) where.push(eq(pastoralAppointment.pastorId, opts.pastorId));
  if (opts.statuses?.length) where.push(inArray(pastoralAppointment.status, opts.statuses));

  return db
    .select({
      a: pastoralAppointment,
      memberFirstName: member.firstName,
      memberLastName: member.lastName,
    })
    .from(pastoralAppointment)
    .leftJoin(
      member,
      and(eq(member.id, pastoralAppointment.memberId), eq(member.churchId, pastoralAppointment.churchId)),
    )
    .where(and(...where))
    .orderBy(opts.order === "desc" ? desc(pastoralAppointment.startsAt) : asc(pastoralAppointment.startsAt))
    .limit(opts.limit ?? 1000);
}

/**
 * Pending appointments per pastor. A grouped aggregate joined in JS, never a
 * correlated subquery (the raw-sql qualifier trap in AGENTS.md).
 */
export async function pendingCounts(churchId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ pastorId: pastoralAppointment.pastorId, n: sql<number>`count(*)::int` })
    .from(pastoralAppointment)
    .where(and(eq(pastoralAppointment.churchId, churchId), eq(pastoralAppointment.status, "pending")))
    .groupBy(pastoralAppointment.pastorId);
  return new Map(rows.filter((r) => r.pastorId).map((r) => [r.pastorId as string, Number(r.n)]));
}

/** Upcoming, slot-holding appointments one phone or email already has here. */
export async function upcomingCountForContact(
  churchId: string,
  phone: string | null,
  email: string | null,
  now: Date,
): Promise<number> {
  if (!phone && !email) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pastoralAppointment)
    .where(
      and(
        eq(pastoralAppointment.churchId, churchId),
        inArray(pastoralAppointment.status, holding),
        gt(pastoralAppointment.startsAt, now),
        or(
          phone ? eq(pastoralAppointment.bookerPhone, phone) : undefined,
          email ? eq(pastoralAppointment.bookerEmail, email) : undefined,
        ),
      ),
    );
  return Number(row?.n ?? 0);
}

/* ------------------------------------------------------------------ *
 * The booking page
 * ------------------------------------------------------------------ */

async function uniqueBookingSlug(base: string): Promise<string> {
  const root = slugify(base).slice(0, 40) || "book";
  let candidate = root;
  // Ten tries, then a long random one that cannot realistically collide.
  for (let i = 0; i < 10; i++) {
    const [taken] = await db
      .select({ slug: pastoralBookingPage.slug })
      .from(pastoralBookingPage)
      .where(eq(pastoralBookingPage.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
    candidate = `${root}-${randomSuffix(3)}`;
  }
  return `${root}-${randomSuffix(8)}`;
}

/** The three types a church starts with, so the page is useful on day one. */
const STARTER_TYPES = [
  { name: "Counselling", durationMinutes: 60, location: "church" as const, requiresApproval: false, sortOrder: 0 },
  { name: "Home visit", durationMinutes: 90, location: "home" as const, requiresApproval: true, sortOrder: 1 },
  { name: "Prayer", durationMinutes: 30, location: "phone" as const, requiresApproval: false, sortOrder: 2 },
];

/**
 * The church's booking page, created on first use, DISABLED, like the
 * welcome link. On first creation a church with no types gets three.
 */
export async function ensureBookingPage(c: {
  id: string;
  name: string;
  handle: string | null;
}): Promise<BookingPageRow> {
  const [existing] = await db
    .select()
    .from(pastoralBookingPage)
    .where(eq(pastoralBookingPage.churchId, c.id))
    .limit(1);
  if (existing) return existing;

  const slug = await uniqueBookingSlug(c.handle || c.name || "book");
  const [created] = await db
    .insert(pastoralBookingPage)
    .values({ churchId: c.id, slug })
    .onConflictDoNothing()
    .returning();
  if (created) {
    const [anyType] = await db
      .select({ id: pastoralBookingType.id })
      .from(pastoralBookingType)
      .where(eq(pastoralBookingType.churchId, c.id))
      .limit(1);
    if (!anyType) {
      await db
        .insert(pastoralBookingType)
        .values(STARTER_TYPES.map((t) => ({ ...t, churchId: c.id })))
        .onConflictDoNothing();
    }
    return created;
  }

  // Lost a race: read the row the other request created.
  const [row] = await db
    .select()
    .from(pastoralBookingPage)
    .where(eq(pastoralBookingPage.churchId, c.id))
    .limit(1);
  return row;
}

export async function getBookingPage(churchId: string): Promise<BookingPageRow | null> {
  const [row] = await db
    .select()
    .from(pastoralBookingPage)
    .where(eq(pastoralBookingPage.churchId, churchId))
    .limit(1);
  return row ?? null;
}

/** A fresh slug, which stops the old link and every printed QR code. */
export async function regenerateBookingSlug(churchId: string, base: string): Promise<string> {
  const slug = await uniqueBookingSlug(`${slugify(base) || "book"}-${randomSuffix(3)}`);
  await db
    .update(pastoralBookingPage)
    .set({ slug })
    .where(eq(pastoralBookingPage.churchId, churchId));
  return slug;
}

export type PublicChurch = {
  id: string;
  name: string;
  logo: string | null;
  theme: string;
  timezone: string;
  country: string;
  publicPhone: string | null;
  publicEmail: string | null;
  defaultLocale: string | null;
  plan: string;
  customPlanId: string | null;
  slug: string;
  isDemo: boolean;
};

/**
 * The public page and its church, or null.
 *
 * Null for an unknown slug, a disabled page, a church whose plan does not
 * include the module, and a church whose automations are paused. The same
 * answer for all four, so this URL cannot be used to learn which churches
 * exist and have merely switched theirs off.
 */
export async function getBookingPageBySlug(
  slug: string,
): Promise<{ page: BookingPageRow; church: PublicChurch } | null> {
  if (!slug || slug.length > 80) return null;
  const [page] = await db
    .select()
    .from(pastoralBookingPage)
    .where(and(eq(pastoralBookingPage.slug, slug), eq(pastoralBookingPage.enabled, true)))
    .limit(1);
  if (!page) return null;

  const [c] = await db
    .select({
      id: church.id,
      name: church.name,
      logo: church.logo,
      theme: church.theme,
      timezone: church.timezone,
      country: church.country,
      publicPhone: church.publicPhone,
      publicEmail: church.publicEmail,
      defaultLocale: church.defaultLocale,
      slug: church.slug,
      customPlanId: church.customPlanId,
      status: church.status,
      ...standingColumns,
    })
    .from(church)
    .where(eq(church.id, page.churchId))
    .limit(1);
  if (!c || c.status === "suspended") return null;
  if (!(await rowHasFeature(c, "pastoralBooking"))) return null;
  if (automationPaused(c)) return null;

  return {
    page,
    church: {
      id: c.id,
      name: c.name,
      logo: c.logo,
      theme: c.theme,
      timezone: c.timezone,
      country: c.country,
      publicPhone: c.publicPhone,
      publicEmail: c.publicEmail,
      defaultLocale: c.defaultLocale,
      plan: c.plan,
      customPlanId: c.customPlanId,
      slug: c.slug,
      isDemo: c.isDemo,
    },
  };
}

export type TokenAppointment = {
  appt: AppointmentRow;
  church: {
    id: string;
    name: string;
    logo: string | null;
    timezone: string;
    country: string;
    publicPhone: string | null;
    defaultLocale: string | null;
  };
  page: BookingPageRow | null;
};

/**
 * The appointment a manage link points at, by the hash of its token. The
 * token itself is never stored, compared in the clear, or logged.
 */
export async function getAppointmentByToken(token: string): Promise<TokenAppointment | null> {
  if (!looksLikeManageToken(token)) return null;
  const [row] = await db
    .select({
      appt: pastoralAppointment,
      churchId: church.id,
      churchName: church.name,
      logo: church.logo,
      timezone: church.timezone,
      country: church.country,
      publicPhone: church.publicPhone,
      defaultLocale: church.defaultLocale,
    })
    .from(pastoralAppointment)
    .innerJoin(church, eq(church.id, pastoralAppointment.churchId))
    .where(eq(pastoralAppointment.manageTokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  return {
    appt: row.appt,
    church: {
      id: row.churchId,
      name: row.churchName,
      logo: row.logo,
      timezone: row.timezone,
      country: row.country,
      publicPhone: row.publicPhone,
      defaultLocale: row.defaultLocale,
    },
    page: await getBookingPage(row.churchId),
  };
}

/* ------------------------------------------------------------------ *
 * The claim
 * ------------------------------------------------------------------ */

/**
 * Hold a pastor for the length of a transaction, so "is this slot free?" and
 * "take it" happen as one step. Deliberately does NOT filter `is_bookable`:
 * staff must still be able to move appointments of a pastor who has been
 * taken off the booking page. Bookability is the public paths' own check.
 */
export async function lockPastorForBooking(
  tx: Executor,
  churchId: string,
  pastorId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: pastorProfile.id })
    .from(pastorProfile)
    .where(and(eq(pastorProfile.id, pastorId), eq(pastorProfile.churchId, churchId)))
    .for("update");
  return rows.length > 0;
}

/**
 * The slot a staff "ignore working hours" booking would take: any 5-minute
 * start from now on, still clear of every held appointment and closure.
 */
function slotIgnoringHours(rules: SlotRules, busy: Busy, startsAtIso: string, now: Date, ignoreId?: string): Slot | null {
  const at = new Date(startsAtIso);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() < now.getTime()) return null;
  if (at.getUTCSeconds() !== 0 || at.getUTCMilliseconds() !== 0 || at.getUTCMinutes() % 5 !== 0) return null;
  const slot = buildSlot(at, rules.durationMinutes, rules.bufferMinutes, rules.timeZone);
  return slotIsFree(slot, busy, ignoreId) ? slot : null;
}

export type ClaimResult =
  | { ok: true; id: string; slot: Slot }
  | { ok: false; reason: "taken" | "missing" };

/**
 * Book a slot: lock, re-check, insert, with the constraint as the floor.
 *
 * The start, end and hold are taken FROM THE SLOT the generator offers, never
 * from the client. A 23P01 from `pastoral_appointment_no_overlap` gives the
 * same "taken" answer as the application check.
 */
export async function claimAppointment(args: {
  churchId: string;
  pastorId: string;
  rules: SlotRules;
  startsAt: string;
  now: Date;
  allowOutsideHours?: boolean;
  values: Omit<NewAppointment, "churchId" | "pastorId" | "startsAt" | "endsAt" | "holdsUntil">;
}): Promise<ClaimResult> {
  try {
    return await db.transaction(async (tx): Promise<ClaimResult> => {
      if (!(await lockPastorForBooking(tx, args.churchId, args.pastorId)))
        return { ok: false, reason: "missing" };
      const at = new Date(args.startsAt);
      if (Number.isNaN(at.getTime())) return { ok: false, reason: "taken" };
      const busy = await busyFor(tx, args.churchId, args.pastorId, at, new Date(at.getTime() + DAY_MS));
      const slot = args.allowOutsideHours
        ? slotIgnoringHours(args.rules, busy, args.startsAt, args.now)
        : isOfferedSlot(args.rules, busy, args.startsAt, args.now);
      if (!slot) return { ok: false, reason: "taken" };

      const [row] = await tx
        .insert(pastoralAppointment)
        .values({
          ...args.values,
          churchId: args.churchId,
          pastorId: args.pastorId,
          startsAt: new Date(slot.startsAt),
          endsAt: new Date(slot.endsAt),
          holdsUntil: new Date(slot.holdsUntil),
        })
        .returning({ id: pastoralAppointment.id });
      return { ok: true, id: row.id, slot };
    });
  } catch (e) {
    if (isBookingOverlapViolation(e)) return { ok: false, reason: "taken" };
    throw e;
  }
}

export type MoveResult =
  | { ok: true; slot: Slot }
  | { ok: false; reason: "taken" | "changed" | "missing" };

/**
 * Move an appointment to a new slot, under the same lock and rules.
 *
 * The UPDATE repeats the predicate (still holding a slot, still at the time
 * the mover saw), and zero rows back means somebody else changed it first.
 * `newTokenHash` replaces the manage link, so the old one stops working.
 */
export async function moveAppointment(args: {
  id: string;
  churchId: string;
  pastorId: string;
  rules: SlotRules;
  expectStartsAt: Date;
  newStartsAt: string;
  now: Date;
  allowOutsideHours?: boolean;
  newTokenHash: string;
  newStatus: "pending" | "confirmed";
  remindAt: (slot: Slot) => Date | null;
}): Promise<MoveResult> {
  try {
    return await db.transaction(async (tx): Promise<MoveResult> => {
      if (!(await lockPastorForBooking(tx, args.churchId, args.pastorId)))
        return { ok: false, reason: "missing" };
      const at = new Date(args.newStartsAt);
      if (Number.isNaN(at.getTime())) return { ok: false, reason: "taken" };
      const busy = await busyFor(tx, args.churchId, args.pastorId, at, new Date(at.getTime() + DAY_MS), args.id);
      const slot = args.allowOutsideHours
        ? slotIgnoringHours(args.rules, busy, args.newStartsAt, args.now, args.id)
        : isOfferedSlot(args.rules, busy, args.newStartsAt, args.now, { ignoreId: args.id });
      if (!slot) return { ok: false, reason: "taken" };

      const moved = await tx
        .update(pastoralAppointment)
        .set({
          startsAt: new Date(slot.startsAt),
          endsAt: new Date(slot.endsAt),
          holdsUntil: new Date(slot.holdsUntil),
          rescheduledFrom: args.expectStartsAt,
          rescheduleCount: sql`${pastoralAppointment.rescheduleCount} + 1`,
          manageTokenHash: args.newTokenHash,
          status: args.newStatus,
          remindAt: args.newStatus === "confirmed" ? args.remindAt(slot) : null,
          reminderSentAt: null,
          reminderOutcome: null,
        })
        .where(
          and(
            eq(pastoralAppointment.id, args.id),
            eq(pastoralAppointment.churchId, args.churchId),
            inArray(pastoralAppointment.status, holding),
            eq(pastoralAppointment.startsAt, args.expectStartsAt),
          ),
        )
        .returning({ id: pastoralAppointment.id });
      if (moved.length !== 1) return { ok: false, reason: "changed" };
      return { ok: true, slot };
    });
  } catch (e) {
    if (isBookingOverlapViolation(e)) return { ok: false, reason: "taken" };
    throw e;
  }
}

/**
 * Change status only from the statuses named, in one conditional UPDATE, so
 * Confirm and Cancel pressed at the same moment cannot both win. Confirm
 * needs no lock: a pending appointment already holds its slot under the
 * constraint. `expectStartsAt` repeats the time the actor saw.
 */
export async function setStatus(args: {
  id: string;
  churchId: string;
  from: AppointmentStatus[];
  to: AppointmentStatus;
  patch?: Partial<Pick<
    NewAppointment,
    "decidedBy" | "decidedAt" | "decisionNote" | "cancelledBy" | "cancelledAt" | "remindAt"
  >>;
  expectStartsAt?: Date;
}): Promise<AppointmentRow | null> {
  const [row] = await db
    .update(pastoralAppointment)
    .set({ ...args.patch, status: args.to })
    .where(
      and(
        eq(pastoralAppointment.id, args.id),
        eq(pastoralAppointment.churchId, args.churchId),
        inArray(pastoralAppointment.status, args.from),
        args.expectStartsAt ? eq(pastoralAppointment.startsAt, args.expectStartsAt) : undefined,
      ),
    )
    .returning();
  return row ?? null;
}

/** Postgres's unique-violation, optionally on one named constraint or index. */
export function isUniqueViolation(e: unknown, name?: string): boolean {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = err?.code ?? err?.cause?.code;
  if (code !== "23505") return false;
  if (!name) return true;
  return (err?.constraint ?? err?.cause?.constraint) === name;
}

/** Write what happened to the confirmation or the reminder. */
export async function recordOutcome(
  id: string,
  which: "confirmation" | "reminder",
  outcome: string,
): Promise<void> {
  try {
    await db
      .update(pastoralAppointment)
      .set(which === "confirmation" ? { confirmationOutcome: outcome } : { reminderOutcome: outcome })
      .where(eq(pastoralAppointment.id, id));
  } catch (e) {
    // The messages already went or failed; losing the record is logged loudly.
    console.error(`[pastoral] could not record the ${which} outcome for appointment ${id}`, e);
  }
}

/**
 * Replace the manage-link hash, but only if it is still the one we read: a
 * reschedule that landed in between keeps its own newer link.
 */
export async function rotateManageHash(
  id: string,
  oldHash: string | null,
  newHash: string,
): Promise<boolean> {
  const rows = await db
    .update(pastoralAppointment)
    .set({ manageTokenHash: newHash })
    .where(
      and(
        eq(pastoralAppointment.id, id),
        oldHash ? eq(pastoralAppointment.manageTokenHash, oldHash) : isNull(pastoralAppointment.manageTokenHash),
      ),
    )
    .returning({ id: pastoralAppointment.id });
  return rows.length === 1;
}
