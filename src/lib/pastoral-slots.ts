/**
 * The times a pastor can be booked, worked out on the church's wall clock.
 *
 * Pure, so the public page, the staff diary, every server write and the tests
 * get the same answer. Every write goes through `isOfferedSlot` with the
 * start time the client asked for, so a crafted request cannot book 03:00, an
 * off-grid 10:07 or a time inside somebody's leave: if the generator would not
 * have offered it, it is refused.
 *
 * The clash test is the facilities one (`findClashes`), not a second copy.
 * Busy appointments arrive with `endsAt` already set to their `holds_until`,
 * so "the proposed [start, holdsUntil) overlaps a held [start, holdsUntil)" is
 * exactly what the database's exclusion constraint tests. findClashes' English
 * reasons are never shown; only whether there is a clash matters here.
 */

import { isRealCalendarDate } from "@/lib/calendar-date";
import { findClashes, type ClashCandidate } from "@/lib/facility-shared";
import { instantFromWallClock, wallClockIn } from "@/lib/meeting-recurrence";
import { MAX_SLOT_WINDOW_DAYS, type WeeklyWindow } from "@/lib/pastoral-shared";

export type { WeeklyWindow };

export type SlotRules = {
  timeZone: string;
  hours: WeeklyWindow[];
  /** The grid start times step along. */
  slotMinutes: number;
  /** How long the appointment itself runs. */
  durationMinutes: number;
  /** Kept free after it. */
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

export type Busy = { appointments: ClashCandidate[]; closures: ClashCandidate[] };

export type Slot = {
  startsAt: string;
  endsAt: string;
  holdsUntil: string;
  /** The church-local date it falls on, YYYY-MM-DD. */
  dayKey: string;
};

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The church-local date of an instant. */
export function todayKey(now: Date, timeZone: string): string {
  const w = wallClockIn(now, timeZone);
  return keyOf(w.year, w.month, w.day);
}

/** A local date moved by whole days, stepped as calendar dates (DST-proof). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** `days` consecutive local dates from `fromDay`. */
export function localDayKeys(fromDay: string, days: number): string[] {
  if (!isRealCalendarDate(fromDay)) return [];
  return Array.from({ length: Math.max(0, days) }, (_, i) => addDaysToKey(fromDay, i));
}

/** The slot an appointment starting at `startsAt` would occupy. */
export function buildSlot(
  startsAt: Date,
  durationMinutes: number,
  bufferMinutes: number,
  timeZone: string,
): Slot {
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const holdsUntil = new Date(endsAt.getTime() + Math.max(0, bufferMinutes) * 60_000);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    holdsUntil: holdsUntil.toISOString(),
    dayKey: todayKey(startsAt, timeZone),
  };
}

/**
 * Is this slot clear of every held appointment (buffer included) and every
 * closure? Closures are compared against [start, end): the buffer is time for
 * the pastor after the appointment, and it may run into the start of leave.
 */
export function slotIsFree(slot: Slot, busy: Busy, ignoreId?: string): boolean {
  if (
    findClashes(
      { startsAt: slot.startsAt, endsAt: slot.holdsUntil },
      busy.appointments,
      { bufferMinutes: 0, ignoreId },
    ).length > 0
  )
    return false;
  return findClashes({ startsAt: slot.startsAt, endsAt: slot.endsAt }, busy.closures).length === 0;
}

function slotsForDay(
  rules: SlotRules,
  busy: Busy,
  dayKey: string,
  now: Date,
  ignoreId?: string,
): Slot[] {
  const [year, month, day] = dayKey.split("-").map(Number);
  // The church's date, so 00:30 Monday in Lagos (23:30 Sunday UTC) is Monday.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const earliest = now.getTime() + Math.max(0, rules.minNoticeMinutes) * 60_000;
  const latest = now.getTime() + Math.max(0, rules.maxAdvanceDays) * DAY_MS;
  const step = Math.max(5, rules.slotMinutes);
  const out: Slot[] = [];
  const seen = new Set<number>();

  const windows = rules.hours
    .filter((w) => w.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);

  for (const w of windows) {
    for (let m = w.startMinute; m + rules.durationMinutes <= w.endMinute; m += step) {
      const hour = Math.floor(m / 60);
      const minute = m % 60;
      const startsAt = instantFromWallClock({ year, month, day, hour, minute }, rules.timeZone);
      // A wall time that does not exist (the spring-forward gap) reads back
      // as a different hour. Skip it rather than offer a time nobody can keep.
      const back = wallClockIn(startsAt, rules.timeZone);
      if (back.hour !== hour || back.minute !== minute || back.day !== day) continue;
      const t = startsAt.getTime();
      if (seen.has(t)) continue;
      if (t < earliest || t > latest) continue;

      const slot = buildSlot(startsAt, rules.durationMinutes, rules.bufferMinutes, rules.timeZone);
      if (!slotIsFree(slot, busy, ignoreId)) continue;
      seen.add(t);
      out.push(slot);
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Every open slot over `days` local dates from `fromDay`, at most
 * MAX_SLOT_WINDOW_DAYS. An impossible `fromDay` gives nothing rather than a
 * rolled-over date.
 */
export function generateSlots(
  rules: SlotRules,
  busy: Busy,
  opts: { now: Date; fromDay: string; days: number; ignoreId?: string },
): Slot[] {
  const days = Math.min(Math.max(0, opts.days), MAX_SLOT_WINDOW_DAYS);
  return localDayKeys(opts.fromDay, days).flatMap((k) =>
    slotsForDay(rules, busy, k, opts.now, opts.ignoreId),
  );
}

/**
 * Does an appointment sit wholly inside the pastor's weekly hours, read on
 * the church's wall clock? Used to mark appointments that were booked before
 * the hours changed (they are never moved automatically) and staff bookings
 * made with "ignore working hours".
 */
export function fitsHours(
  startsAt: Date | string,
  endsAt: Date | string,
  hours: WeeklyWindow[],
  timeZone: string,
): boolean {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const ws = wallClockIn(s, timeZone);
  const we = wallClockIn(e, timeZone);
  const weekday = new Date(Date.UTC(ws.year, ws.month - 1, ws.day)).getUTCDay();
  const start = ws.hour * 60 + ws.minute;
  const sameDay = ws.year === we.year && ws.month === we.month && ws.day === we.day;
  // An end at exactly midnight belongs to the day it closes.
  const end = sameDay ? we.hour * 60 + we.minute : we.hour === 0 && we.minute === 0 ? 1440 : -1;
  if (end < 0) return false;
  return hours.some(
    (w) => w.weekday === weekday && w.startMinute <= start && end <= w.endMinute,
  );
}

/**
 * The slot starting exactly at `startsAtIso`, if the generator would offer
 * it right now; otherwise null. The server's only way to accept a time.
 */
export function isOfferedSlot(
  rules: SlotRules,
  busy: Busy,
  startsAtIso: string,
  now: Date,
  opts: { ignoreId?: string } = {},
): Slot | null {
  const at = new Date(startsAtIso);
  if (Number.isNaN(at.getTime())) return null;
  const dayKey = todayKey(at, rules.timeZone);
  return (
    slotsForDay(rules, busy, dayKey, now, opts.ignoreId).find(
      (s) => new Date(s.startsAt).getTime() === at.getTime(),
    ) ?? null
  );
}

/**
 * A datetime-local value ("2026-11-03T09:30"), read as a wall clock in the
 * church's zone, as an ISO instant. Null when it is not a real time. The
 * browser's own zone is never consulted: the office in Lagos and a manager
 * travelling in London must both mean 09:30 in Lagos.
 */
export function wallInputToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (!isRealCalendarDate(`${m[1]}-${m[2]}-${m[3]}`) || hour > 23 || minute > 59) return null;
  return instantFromWallClock({ year, month, day, hour, minute }, timeZone).toISOString();
}
