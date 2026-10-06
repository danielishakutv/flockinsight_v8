/**
 * Facilities: the rules, with no database anywhere near them.
 *
 * Pure, so the page, the server action and the tests all answer "is the hall
 * free on Saturday" the same way. The clash check in particular is the whole
 * module — everything else here is labels.
 */

export type FacilityKind =
  | "hall"
  | "room"
  | "open_space"
  | "equipment"
  | "vehicle"
  | "other";

export type FacilityRate = "free" | "hour" | "day" | "session";

export type BookingStatus = "requested" | "approved" | "declined" | "cancelled";

export type ClosureKind =
  | "maintenance"
  | "repair"
  | "cleaning"
  | "reserved"
  | "other";

export const FACILITY_KINDS: { value: FacilityKind; label: string; hint: string }[] = [
  { value: "hall", label: "Hall", hint: "Auditorium, fellowship hall, chapel" },
  { value: "room", label: "Room", hint: "Classroom, office, nursery, kitchen" },
  { value: "open_space", label: "Open space", hint: "Field, grounds, car park" },
  { value: "equipment", label: "Equipment", hint: "Chairs, canopies, PA, generator" },
  { value: "vehicle", label: "Vehicle", hint: "The church bus" },
  { value: "other", label: "Other", hint: "Anything else worth keeping track of" },
];

export const FACILITY_RATES: { value: FacilityRate; label: string }[] = [
  { value: "free", label: "Not hired out" },
  { value: "hour", label: "Per hour" },
  { value: "day", label: "Per day" },
  { value: "session", label: "Per booking" },
];

export const BOOKING_STATUSES: {
  value: BookingStatus;
  label: string;
  hint: string;
  className: string;
}[] = [
  {
    value: "requested",
    label: "Awaiting approval",
    hint: "Asked for. Does not hold the slot yet.",
    className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  {
    value: "approved",
    label: "Approved",
    hint: "Holds the slot. Nothing else can be booked over it.",
    className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "declined",
    label: "Declined",
    hint: "Turned down, with a reason.",
    className: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    hint: "Called off. The slot is free again.",
    className: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
  },
];

export const CLOSURE_KINDS: { value: ClosureKind; label: string }[] = [
  { value: "maintenance", label: "Maintenance" },
  { value: "repair", label: "Repair" },
  { value: "cleaning", label: "Deep clean" },
  { value: "reserved", label: "Held by the church" },
  { value: "other", label: "Other" },
];

export function kindLabel(k: string): string {
  return FACILITY_KINDS.find((x) => x.value === k)?.label ?? "Other";
}
export function statusMeta(s: string) {
  return BOOKING_STATUSES.find((x) => x.value === s) ?? BOOKING_STATUSES[0];
}
export function closureLabel(k: string): string {
  return CLOSURE_KINDS.find((x) => x.value === k)?.label ?? "Closed";
}

/**
 * Only an APPROVED booking holds the slot.
 *
 * A request does not, which is the point of there being a request: two people
 * may ask for the same Saturday, and whoever approves one decides. Declined and
 * cancelled bookings hold nothing at all.
 */
export function blocksTheSlot(status: string): boolean {
  return status === "approved";
}

/* ============================================================
 * The clash check
 * ========================================================== */

export type Interval = { startsAt: Date | string; endsAt: Date | string };

const ms = (v: Date | string): number =>
  v instanceof Date ? v.getTime() : new Date(v).getTime();

/**
 * Do two periods overlap?
 *
 * Half-open on purpose: `[start, end)`. A booking that ends at 12:00 does NOT
 * clash with one that starts at 12:00, because the hall is genuinely free at
 * noon and a church that cannot book 10–12 and 12–2 on the same morning will
 * stop using the module by lunchtime. Touching ends are not an overlap.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return ms(a.startsAt) < ms(b.endsAt) && ms(b.startsAt) < ms(a.endsAt);
}

/** Widen a period by a buffer on each side, for setting up and clearing away. */
export function withBuffer(i: Interval, bufferMinutes: number): Interval {
  const pad = Math.max(0, bufferMinutes) * 60_000;
  return {
    startsAt: new Date(ms(i.startsAt) - pad),
    endsAt: new Date(ms(i.endsAt) + pad),
  };
}

export type ClashCandidate = Interval & {
  id: string;
  /** What to call it when telling somebody why they cannot have the slot. */
  label: string;
  /** "booking" or "closure" — the sentence differs. */
  sort: "booking" | "closure";
};

export type Clash = { with: ClashCandidate; reason: string };

/**
 * Everything already standing in the way of a proposed period.
 *
 * The buffer is applied to the EXISTING entries, not the proposed one, and that
 * asymmetry is deliberate: the buffer belongs to the booking that needs
 * clearing away, so a 60-minute buffer means an hour after the wedding, not an
 * hour either side of whatever anybody asks for next.
 *
 * `ignoreId` lets a booking be edited without clashing with itself.
 */
export function findClashes(
  proposed: Interval,
  existing: ClashCandidate[],
  opts: { bufferMinutes?: number; ignoreId?: string } = {},
): Clash[] {
  const buffer = opts.bufferMinutes ?? 0;
  const out: Clash[] = [];

  for (const e of existing) {
    if (opts.ignoreId && e.id === opts.ignoreId) continue;

    // A closure is a closure: no buffer, it is simply shut.
    const window = e.sort === "closure" ? e : withBuffer(e, buffer);
    if (!overlaps(proposed, window)) continue;

    out.push({
      with: e,
      reason:
        e.sort === "closure"
          ? `It is closed then — ${e.label}.`
          : buffer > 0 && !overlaps(proposed, e)
            ? `${e.label} is booked close to that, and this needs ${buffer} minutes either side to set up and clear away.`
            : `${e.label} is already booked then.`,
    });
  }
  return out;
}

/* ============================================================
 * Validating a booking before anything is written
 * ========================================================== */

export type BookingInput = {
  facilityId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  expectedAttendance?: number | null;
};

export type Validated = {
  facilityId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
};

export type ValidationResult =
  | { ok: true; value: Validated }
  | { ok: false; error: string };

/** The longest a single booking may run. A year-long booking is a typo. */
const MAX_DAYS = 30;

export function validateBooking(
  input: BookingInput,
  opts: { now?: Date; capacity?: number | null } = {},
): ValidationResult {
  const title = input.title?.trim();
  if (!title || title.length < 2) {
    return { ok: false, error: "Give the booking a name, so the calendar reads properly." };
  }
  if (!input.facilityId) return { ok: false, error: "Choose what is being booked." };

  const starts = new Date(input.startsAt);
  const ends = new Date(input.endsAt);
  if (Number.isNaN(starts.getTime())) return { ok: false, error: "That start time is not a real date." };
  if (Number.isNaN(ends.getTime())) return { ok: false, error: "That end time is not a real date." };

  if (ends.getTime() <= starts.getTime()) {
    return { ok: false, error: "It has to end after it starts." };
  }

  const days = (ends.getTime() - starts.getTime()) / 86_400_000;
  if (days > MAX_DAYS) {
    return {
      ok: false,
      error: `That is over ${MAX_DAYS} days. If something is out of use for that long, close it for maintenance instead of booking it.`,
    };
  }

  /*
   * Booking the past is allowed, deliberately.
   *
   * Churches write last Saturday's wedding down on Monday, and refusing that
   * would send them back to the paper diary this module is replacing. The UI
   * says it is in the past; it does not forbid it.
   */

  if (
    opts.capacity != null &&
    input.expectedAttendance != null &&
    input.expectedAttendance > opts.capacity
  ) {
    return {
      ok: false,
      error: `That is more people than it holds — capacity is ${opts.capacity}.`,
    };
  }

  return { ok: true, value: { facilityId: input.facilityId, title, startsAt: starts, endsAt: ends } };
}

/* ============================================================
 * What it costs
 * ========================================================== */

/**
 * Work out the fee from the facility's rate, rounded UP to the next unit.
 *
 * Up, not nearest: a hall hired for 2 hours 10 minutes is charged 3 hours, the
 * way every hall in the world is charged, and a church reading a figure it did
 * not expect will not trust the next one.
 */
export function feeFor(
  rate: FacilityRate,
  hireFee: number | null | undefined,
  period: Interval,
): number | null {
  if (rate === "free" || hireFee == null || hireFee <= 0) return null;
  if (rate === "session") return hireFee;

  const minutes = (ms(period.endsAt) - ms(period.startsAt)) / 60_000;
  if (minutes <= 0) return null;

  const per = rate === "hour" ? 60 : 1440;
  return hireFee * Math.max(1, Math.ceil(minutes / per));
}

/** "2 hours", "3 days", "45 minutes" — for a summary line. */
export function durationLabel(period: Interval): string {
  const minutes = Math.round((ms(period.endsAt) - ms(period.startsAt)) / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 1440) {
    const h = minutes / 60;
    const r = Number.isInteger(h) ? String(h) : h.toFixed(1);
    return `${r} hour${h === 1 ? "" : "s"}`;
  }
  const d = minutes / 1440;
  const r = Number.isInteger(d) ? String(d) : d.toFixed(1);
  return `${r} day${d === 1 ? "" : "s"}`;
}
