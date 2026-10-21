/**
 * Pastoral appointments: the rules, with no database anywhere near them.
 *
 * Pure and client-safe, so the diary, the public booking page, the server
 * actions and the tests all answer "is this a valid set of hours?" and "who
 * may read what this appointment is about?" the same way.
 *
 * Validators return a dictionary key rather than an English sentence. The
 * same rule runs on a French booking page and in an English staff action, and
 * a sentence baked in here would be English on both.
 */

import { isValidTimeZone, timezoneForCountry } from "@/lib/country-profile";
import { normalizeEmail } from "@/lib/email-address";
import { e164Phone } from "@/lib/phone-intl";
import type { TKey, TVars } from "@/lib/i18n/translate";

export type AppointmentStatus = "pending" | "confirmed" | "declined" | "cancelled";
export type PastoralLocation = "church" | "home" | "phone" | "online";
export type PastorClosureKind = "leave" | "travel" | "conference" | "sick" | "other";
export type BookingVisibility = "public" | "members";
export type BookingSource = "public" | "members" | "staff";

/** A sentence still to be translated: the caller holds the `t`. */
export type Msg = { key: TKey; vars?: TVars };
export type Checked<T> = { ok: true; value: T } | { ok: false; error: Msg };

/** Longest stretch one slot list may cover. Bounds a single request's work. */
export const MAX_SLOT_WINDOW_DAYS = 14;
/**
 * Moves the manage link allows before the booker has to call. A diary that
 * can be shuffled without limit by a stranger's link is not a diary.
 */
export const MAX_SELF_RESCHEDULES = 3;
export const MAX_WINDOWS_PER_DAY = 6;

export const APPOINTMENT_STATUSES: {
  value: AppointmentStatus;
  labelKey: TKey;
  className: string;
}[] = [
  {
    value: "pending",
    labelKey: "pastoral.status.pending",
    className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  {
    value: "confirmed",
    labelKey: "pastoral.status.confirmed",
    className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "declined",
    labelKey: "pastoral.status.declined",
    className: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  },
  {
    value: "cancelled",
    labelKey: "pastoral.status.cancelled",
    className: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
  },
];

export function statusMeta(s: string) {
  return APPOINTMENT_STATUSES.find((x) => x.value === s) ?? APPOINTMENT_STATUSES[0];
}

export const LOCATIONS: { value: PastoralLocation; labelKey: TKey }[] = [
  { value: "church", labelKey: "pastoral.location.church" },
  { value: "home", labelKey: "pastoral.location.home" },
  { value: "phone", labelKey: "pastoral.location.phone" },
  { value: "online", labelKey: "pastoral.location.online" },
];

export function locationKey(l: string): TKey {
  return LOCATIONS.find((x) => x.value === l)?.labelKey ?? "pastoral.location.church";
}

export const CLOSURE_KINDS: { value: PastorClosureKind; labelKey: TKey }[] = [
  { value: "leave", labelKey: "pastoral.closure.leave" },
  { value: "travel", labelKey: "pastoral.closure.travel" },
  { value: "conference", labelKey: "pastoral.closure.conference" },
  { value: "sick", labelKey: "pastoral.closure.sick" },
  // The dictionary cannot hold a key called `other` (it marks a plural pair).
  { value: "other", labelKey: "pastoral.closure.away" },
];

export function closureKey(k: string): TKey {
  return CLOSURE_KINDS.find((x) => x.value === k)?.labelKey ?? "pastoral.closure.away";
}

/** The statuses that keep a slot. The exclusion constraint's WHERE, in TypeScript. */
export const HOLDING_STATUSES = ["pending", "confirmed"] as const;

/**
 * Does an appointment in this status keep its slot?
 *
 * A pending appointment does, unlike a facility request: the booker was shown
 * the time as free and told so. Must match `pastoral_appointment_no_overlap`'s
 * WHERE in migration 0106 exactly; pastoral-shared.test.ts reads the file.
 */
export function holdsTheSlot(status: string): boolean {
  return (HOLDING_STATUSES as readonly string[]).includes(status);
}

/**
 * The zone every slot is made and shown in: the church's own, or its
 * country's when the stored one is not a zone Intl knows. Never the server's.
 */
export function churchZone(c: { timezone?: string | null; country?: string | null }): string {
  return isValidTimeZone(c.timezone) ? c.timezone : timezoneForCountry(c.country);
}

/* ============================================================
 * Weekly hours
 * ========================================================== */

export type WeeklyWindow = { weekday: number; startMinute: number; endMinute: number };

const ENGLISH_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Check a pastor's weekly hours before they are written.
 *
 * Touching windows (9-12 and 12-3) are allowed, half-open like the facilities
 * clash rule. Overlapping ones are refused rather than merged, because a
 * merge would silently change what somebody typed. `dayNames` lets the error
 * name the day in the reader's language; Sunday first, as JS counts.
 */
export function validateWeeklyHours(
  windows: WeeklyWindow[],
  dayNames: string[] = ENGLISH_DAYS,
): Checked<WeeklyWindow[]> {
  const day = (w: number) => dayNames[w] ?? ENGLISH_DAYS[w] ?? String(w);
  for (const w of windows) {
    if (!Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6)
      return { ok: false, error: { key: "pastoral.errors.hoursWeekday" } };
    const onStep = (m: number) => Number.isInteger(m) && m >= 0 && m <= 1440 && m % 5 === 0;
    if (!onStep(w.startMinute) || !onStep(w.endMinute))
      return { ok: false, error: { key: "pastoral.errors.hoursStep", vars: { day: day(w.weekday) } } };
    if (w.startMinute >= w.endMinute)
      return { ok: false, error: { key: "pastoral.errors.hoursOrder", vars: { day: day(w.weekday) } } };
  }

  const sorted = [...windows].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  for (let d = 0; d < 7; d++) {
    const today = sorted.filter((w) => w.weekday === d);
    if (today.length > MAX_WINDOWS_PER_DAY)
      return {
        ok: false,
        error: { key: "pastoral.errors.hoursTooMany", vars: { day: day(d), max: MAX_WINDOWS_PER_DAY } },
      };
    for (let i = 1; i < today.length; i++) {
      if (today[i].startMinute < today[i - 1].endMinute)
        return { ok: false, error: { key: "pastoral.hours.overlap", vars: { day: day(d) } } };
    }
  }
  return { ok: true, value: sorted.map((w) => ({ ...w })) };
}

/** 540 -> "09:00". 1440 reads "24:00", the end of the day. */
export function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:30" -> 570, or null when it is not a time. "24:00" is allowed as an end. */
export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/* ============================================================
 * The person booking
 * ========================================================== */

export type BookerInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  topic?: string | null;
  address?: string | null;
};

export type CleanBooker = {
  name: string;
  phone: string | null;
  email: string | null;
  topic: string | null;
  address: string | null;
};

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Check who is booking.
 *
 * `needContact` is true on the public and members pages: a booking nobody can
 * confirm or remind is a booking that gets forgotten. Staff may book with
 * neither, because they are usually booking for somebody standing in front of
 * them. The phone is stored in E.164 with the church's dial code, so the
 * per-contact limit compares like with like.
 */
export function validateBooker(
  input: BookerInput,
  opts: { location: string; needContact: boolean; dial: string },
): Checked<CleanBooker> {
  const name = trimmed(input.name);
  if (name.length < 2) return { ok: false, error: { key: "pastoral.errors.name" } };
  if (name.length > 120) return { ok: false, error: { key: "pastoral.errors.nameLong" } };

  const emailRaw = trimmed(input.email);
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && !email) return { ok: false, error: { key: "pastoral.errors.email" } };

  const phoneRaw = trimmed(input.phone);
  const phone = phoneRaw ? e164Phone(phoneRaw, opts.dial) : null;
  if (phoneRaw && !phone) return { ok: false, error: { key: "pastoral.errors.phone" } };

  if (opts.needContact && !phone && !email)
    return { ok: false, error: { key: "pastoral.public.needContact" } };

  const topic = trimmed(input.topic);
  if (topic.length > 1000) return { ok: false, error: { key: "pastoral.errors.topicLong" } };

  const address = trimmed(input.address);
  if (address.length > 300) return { ok: false, error: { key: "pastoral.errors.addressLong" } };
  if (opts.location === "home" && !address)
    return { ok: false, error: { key: "pastoral.errors.addressNeeded" } };

  return {
    ok: true,
    value: {
      name,
      phone,
      email: email ? email.toLowerCase() : null,
      topic: topic || null,
      address: address || null,
    },
  };
}

/** How long an appointment of this type runs with this pastor. */
export function appointmentLength(
  type: { durationMinutes: number | null },
  pastor: { slotMinutes: number },
): number {
  return type.durationMinutes ?? pastor.slotMinutes;
}

/**
 * Who may read what an appointment is about: the pastor it is with, and
 * whoever manages every diary. Nobody else, including the rest of the team.
 */
export function canSeeTopic(who: { isThePastor: boolean; canManage: boolean }): boolean {
  return who.isThePastor || who.canManage;
}

/** "Ade Okafor" -> first "Ade", last "Okafor". One word is a first name. */
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? full.trim(), lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/* ============================================================
 * What happened to each message
 * ========================================================== */

export type DeliveryChannel = "email" | "sms";
/** sent | queued@<iso> | skipped | failed:<reason> | off | noplan */
export type DeliveryToken = string;

/** A failure reason inside one space-free token: spaces become underscores. */
export function failedToken(reason: string): DeliveryToken {
  const clean = reason.replace(/\s+/g, "_").replace(/[^\w.,:@'()-]/g, "").slice(0, 80);
  return `failed:${clean || "unknown"}`;
}

/** Join per-channel outcomes into the column's one string. */
export function formatOutcome(parts: Partial<Record<DeliveryChannel, DeliveryToken>>): string {
  return (["email", "sms"] as const)
    .filter((c) => parts[c])
    .map((c) => `${c}:${parts[c]}`)
    .join(" ");
}

/** True when at least one channel sent or queued a message. */
export function anyDelivered(outcome: string | null | undefined): boolean {
  return /(^|\s)(email|sms):(sent|queued@)/.test(outcome ?? "");
}

export type DeliveryLine = { channel: DeliveryChannel; key: TKey; vars?: TVars };

/**
 * Read "email:sent sms:queued@<iso>" back into lines to show.
 *
 * So a confirmation that did not arrive is on the appointment in words
 * instead of being a silence somebody discovers on the day. `formatTime`
 * turns the queued instant into the reader's own clock.
 */
export function describeDelivery(
  outcome: string | null | undefined,
  formatTime: (iso: string) => string = (iso) => iso,
): DeliveryLine[] {
  const out: DeliveryLine[] = [];
  for (const m of (outcome ?? "").matchAll(/(email|sms):(\S+)/g)) {
    const channel = m[1] as DeliveryChannel;
    const token = m[2];
    if (token === "sent") out.push({ channel, key: "pastoral.sheet.delivery.sent" });
    else if (token === "skipped") out.push({ channel, key: "pastoral.sheet.delivery.skipped" });
    else if (token === "off") out.push({ channel, key: "pastoral.sheet.delivery.off" });
    else if (token === "noplan") out.push({ channel, key: "pastoral.sheet.delivery.noPlan" });
    else if (token.startsWith("queued@"))
      out.push({
        channel,
        key: "pastoral.sheet.delivery.queued",
        vars: { time: formatTime(token.slice("queued@".length)) },
      });
    else if (token.startsWith("failed:"))
      out.push({
        channel,
        key: "pastoral.sheet.delivery.failed",
        vars: { reason: token.slice("failed:".length).replace(/_/g, " ") },
      });
  }
  return out;
}
