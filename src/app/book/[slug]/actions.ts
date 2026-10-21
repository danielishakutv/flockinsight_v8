"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { auditGuest } from "@/lib/audit";
import { getLocale, getT } from "@/lib/i18n/server";
import { countryProfile } from "@/lib/country-profile";
import { isRealCalendarDate } from "@/lib/calendar-date";
import { findExistingMember } from "@/lib/member-signup";
import { notifyChurchManagers } from "@/lib/notifications";
import { verifyOtp } from "@/lib/otp";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  claimAppointment,
  getBookingPageBySlug,
  getType,
  hoursOf,
  listPastors,
  manageUrl,
  openSlots,
  pastorOffersType,
  rulesFor,
  upcomingCountForContact,
  type PublicChurch,
} from "@/lib/pastoral";
import { afterBooking, PASTORAL_OTP_PURPOSE, sendBookingCode } from "@/lib/pastoral-notify";
import { formatWhen, remindAtFor } from "@/lib/pastoral-messages";
import { icsUid } from "@/lib/pastoral-ics";
import {
  MAX_SLOT_WINDOW_DAYS,
  churchZone,
  locationKey,
  validateBooker,
} from "@/lib/pastoral-shared";
import { addDaysToKey, todayKey, type Slot } from "@/lib/pastoral-slots";
import {
  MEMBER_TICKET_TTL_MS,
  hashToken,
  memberTicketSecret,
  newManageToken,
  signMemberTicket,
  verifyMemberTicket,
} from "@/lib/pastoral-tokens";
import { normalizeEmail } from "@/lib/email-address";

/**
 * The public booking page's actions. Unauthenticated, so everything here is
 * deliberately narrow.
 *
 * A stranger can never set a status, a source, a member link, "verified", an
 * end time, a hold, a creator or a locale, nor name any id but a pastor and a
 * type, and both of those are checked against the slug's church. The page
 * must be on, the plan must include the module, and the church must be in
 * good standing; unknown, off, off-plan and lapsed all give the same answer.
 *
 * Every call is rate-limited per address, and the writes per church too.
 */

const HOUR = 60 * 60_000;
const BOOKINGS_PER_CHURCH_PER_HOUR = 60;

export type PublicSlots =
  | { ok: true; zone: string; slots: Slot[]; nextFromDay: string }
  | { ok: false; error: string };

type Bookable = {
  pastor: Awaited<ReturnType<typeof listPastors>>[number];
  type: NonNullable<Awaited<ReturnType<typeof getType>>>;
};

/** The pastor and the type, if this church offers that pairing to the public now. */
async function bookable(churchId: string, pastorId: string, typeId: string): Promise<Bookable | null> {
  if (typeof pastorId !== "string" || typeof typeId !== "string") return null;
  const pastor = (await listPastors(churchId, { bookableOnly: true })).find((p) => p.id === pastorId);
  if (!pastor) return null;
  const type = await getType(churchId, typeId);
  if (!type || !type.isActive) return null;
  if (!(await pastorOffersType(churchId, pastor.id, type.id))) return null;
  return { pastor, type };
}

async function slotsFor(c: PublicChurch, b: Bookable, fromDay: string, now: Date) {
  const zone = churchZone(c);
  const day = isRealCalendarDate(fromDay) ? fromDay : todayKey(now, zone);
  const rules = rulesFor(b.pastor, await hoursOf(c.id, b.pastor.id), b.type, zone);
  const slots = await openSlots({
    churchId: c.id,
    pastorId: b.pastor.id,
    rules,
    fromDay: day,
    days: MAX_SLOT_WINDOW_DAYS,
    now,
  });
  return { zone, rules, day, slots };
}

export async function listOpenSlots(
  slug: string,
  pastorId: string,
  typeId: string,
  fromDay: string,
): Promise<PublicSlots> {
  const t = await getT();
  if (!rateLimit(`book-slots:${await clientIp()}`, 240, 10 * 60_000).ok)
    return { ok: false, error: t("pastoral.public.tooMany") };
  const data = await getBookingPageBySlug(slug);
  if (!data) return { ok: false, error: t("pastoral.public.unavailable") };
  const b = await bookable(data.church.id, pastorId, typeId);
  if (!b) return { ok: false, error: t("pastoral.public.unavailable") };
  const { zone, day, slots } = await slotsFor(data.church, b, fromDay, new Date());
  return { ok: true, zone, slots, nextFromDay: addDaysToKey(day, MAX_SLOT_WINDOW_DAYS) };
}

/* ------------------------------------------------------------------ *
 * Members-only: a one-time code to the contact the church has on file
 * ------------------------------------------------------------------ */

export type StartVerification =
  | { ok: true; otpId: string; message: string }
  | { ok: false; error: string };

/**
 * The reply is the same whether or not the contact matched anybody, and
 * whether or not the code could be sent, so this is not a way to ask "is this
 * number a member here?". With no match the id is random and matches no code.
 */
export async function startMemberVerification(slug: string, contact: string): Promise<StartVerification> {
  const t = await getT();
  if (!rateLimit(`book-otp:${await clientIp()}`, 10, HOUR).ok)
    return { ok: false, error: t("pastoral.public.tooMany") };
  const data = await getBookingPageBySlug(slug);
  if (!data || data.page.visibility !== "members") return { ok: false, error: t("pastoral.public.unavailable") };
  if (!memberTicketSecret()) return { ok: false, error: t("pastoral.page.secretMissing") };
  if (!rateLimit(`book-otp-church:${data.church.id}`, 60, HOUR).ok)
    return { ok: false, error: t("pastoral.public.tooMany") };

  const reply = { ok: true as const, message: t("pastoral.public.verifySent", { church: data.church.name }) };
  const raw = (typeof contact === "string" ? contact : "").trim().slice(0, 200);
  const email = raw.includes("@") ? normalizeEmail(raw) : null;
  const phone = raw.includes("@") ? null : raw || null;
  if (!email && !phone) return { ...reply, otpId: randomUUID() };

  const found = await findExistingMember(data.church.id, email, phone, countryProfile(data.church.country).dial);
  if (!found) return { ...reply, otpId: randomUUID() };

  const sent = await sendBookingCode({
    church: data.church,
    member: { id: found.id, email: found.email, phone: found.phone },
    t,
  });
  if (!sent.ok) {
    console.error(`[book] could not send a booking code to member ${found.id}: ${sent.error}`);
    return { ...reply, otpId: randomUUID() };
  }
  return { ...reply, otpId: sent.otpId };
}

export type VerifyCode =
  | { ok: true; ticket: string; firstName: string }
  | { ok: false; error: string };

export async function verifyMemberCode(slug: string, otpId: string, code: string): Promise<VerifyCode> {
  const t = await getT();
  if (!rateLimit(`book-otp-check:${await clientIp()}`, 30, HOUR).ok)
    return { ok: false, error: t("pastoral.public.tooMany") };
  const data = await getBookingPageBySlug(slug);
  if (!data || data.page.visibility !== "members") return { ok: false, error: t("pastoral.public.unavailable") };
  const secret = memberTicketSecret();
  if (!secret) return { ok: false, error: t("pastoral.page.secretMissing") };
  if (typeof otpId !== "string" || !/^[0-9a-f-]{36}$/i.test(otpId))
    return { ok: false, error: t("pastoral.public.verifyFailed") };

  const res = await verifyOtp(otpId, String(code ?? ""), { expectedPurpose: PASTORAL_OTP_PURPOSE });
  // Every failure reads the same, so the form tells an attacker nothing.
  if (!res.ok || res.churchId !== data.church.id || !res.memberId)
    return { ok: false, error: t("pastoral.public.verifyFailed") };

  const [m] = await db
    .select({ firstName: member.firstName })
    .from(member)
    .where(and(eq(member.id, res.memberId), eq(member.churchId, data.church.id)))
    .limit(1);
  if (!m) return { ok: false, error: t("pastoral.public.verifyFailed") };

  return {
    ok: true,
    ticket: signMemberTicket(
      { churchId: data.church.id, memberId: res.memberId, exp: Date.now() + MEMBER_TICKET_TTL_MS },
      secret,
    ),
    firstName: m.firstName,
  };
}

/* ------------------------------------------------------------------ *
 * Booking
 * ------------------------------------------------------------------ */

export type BookingInput = {
  pastorId: string;
  typeId: string;
  startsAt: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  topic?: string;
  /** Members-only: the ticket verifyMemberCode returned. */
  ticket?: string;
};

export type BookingSuccess = {
  ok: true;
  status: "pending" | "confirmed";
  when: string;
  zone: string;
  pastorName: string;
  typeName: string;
  manageUrl: string;
  ics: { uid: string; sequence: number; startsAt: string; endsAt: string; summary: string; location: string } | null;
  emailFailed: boolean;
  smsQueued: boolean;
};

export type BookingResult =
  | BookingSuccess
  | {
      ok: false;
      error: string;
      taken?: boolean;
      slots?: Slot[];
      /** Members-only: the half-hour proof has run out, so the code step comes again. */
      reverify?: boolean;
    };

export async function submitBooking(
  slug: string,
  input: BookingInput,
  /** A field no human can see. Bots fill it in; people do not. */
  honeypot?: string,
): Promise<BookingResult> {
  const t = await getT();

  // A filled honeypot is told it worked and nothing is written, so whoever
  // wrote the bot learns nothing about which field gave it away.
  if (honeypot && honeypot.trim()) {
    return {
      ok: true,
      status: "confirmed",
      when: "",
      zone: "",
      pastorName: "",
      typeName: "",
      manageUrl: "",
      ics: null,
      emailFailed: false,
      smsQueued: false,
    };
  }

  if (!rateLimit(`book:${await clientIp()}`, 10, HOUR).ok) return { ok: false, error: t("pastoral.public.tooMany") };

  const data = await getBookingPageBySlug(slug);
  if (!data) return { ok: false, error: t("pastoral.public.unavailable") };
  const c = data.church;
  const page = data.page;

  if (!rateLimit(`book-church:${c.id}`, BOOKINGS_PER_CHURCH_PER_HOUR, HOUR).ok) {
    // At most hourly: a page being turned away looks broken from outside,
    // and only the managers can act on it.
    if (rateLimit(`book-notice:${c.id}`, 1, HOUR).ok) {
      await notifyChurchManagers({
        churchId: c.id,
        title: "Your pastor booking page is turning people away",
        body: `More than ${BOOKINGS_PER_CHURCH_PER_HOUR} bookings arrived through your pastor booking page in the last hour, so further ones are being refused for now. If these are not genuine, switch the page off or issue a new link under Appointments → Booking page.`,
        linkUrl: "/appointments",
      }).catch((e: unknown) => {
        // The refusal stands either way; a lost notice is logged, not thrown.
        console.error("[book] could not tell managers about the flood", e);
      });
    }
    return { ok: false, error: t("pastoral.public.tooMany") };
  }

  const b = await bookable(c.id, input?.pastorId, input?.typeId);
  if (!b) return { ok: false, error: t("pastoral.public.unavailable") };
  const dial = countryProfile(c.country).dial;

  // Who is booking. Members mode takes the contact from the register; the
  // public page links a member read-only and never writes to their record.
  let memberId: string | null = null;
  let identityVerified = false;
  let source: "public" | "members" = "public";
  let name: string;
  let phone: string | null;
  let email: string | null;
  let address: string | null;
  let topic: string | null;

  if (page.visibility === "members") {
    const ticket = verifyMemberTicket(String(input.ticket ?? ""), c.id, new Date(), memberTicketSecret());
    if (!ticket) return { ok: false, error: t("pastoral.public.verifyAgain"), reverify: true };
    const [m] = await db
      .select({ id: member.id, firstName: member.firstName, lastName: member.lastName, phone: member.phone, email: member.email })
      .from(member)
      .where(and(eq(member.id, ticket.memberId), eq(member.churchId, c.id)))
      .limit(1);
    if (!m) return { ok: false, error: t("pastoral.public.verifyAgain"), reverify: true };
    const fullName = [m.firstName, m.lastName].filter(Boolean).join(" ");
    const contact = validateBooker({ name: fullName, phone: m.phone, email: m.email }, { location: "church", needContact: false, dial });
    const extra = validateBooker(
      { name: fullName || "Member", address: input.address, topic: input.topic },
      { location: b.type.location, needContact: false, dial },
    );
    if (!extra.ok) return { ok: false, error: t(extra.error.key, extra.error.vars) };
    memberId = m.id;
    identityVerified = true;
    source = "members";
    name = fullName || "Member";
    phone = contact.ok ? contact.value.phone : null;
    email = contact.ok ? contact.value.email : null;
    address = extra.value.address;
    topic = extra.value.topic;
  } else {
    const checked = validateBooker(
      { name: input.name, phone: input.phone, email: input.email, address: input.address, topic: input.topic },
      { location: b.type.location, needContact: true, dial },
    );
    if (!checked.ok) return { ok: false, error: t(checked.error.key, checked.error.vars) };
    ({ name, phone, email, address, topic } = checked.value);
    memberId = (await findExistingMember(c.id, email, phone, dial))?.id ?? null;
  }

  // Soft on purpose: it bounds nuisance, not money.
  const now = new Date();
  const held = await upcomingCountForContact(c.id, phone, email, now);
  if (held >= page.maxUpcomingPerContact)
    return { ok: false, error: t("pastoral.public.limit", { count: held }) };

  const zone = churchZone(c);
  const rules = rulesFor(b.pastor, await hoursOf(c.id, b.pastor.id), b.type, zone);
  const status = b.type.requiresApproval ? "pending" : "confirmed";
  const token = newManageToken();
  const startsAtDate = new Date(String(input.startsAt ?? ""));
  const claim = await claimAppointment({
    churchId: c.id,
    pastorId: b.pastor.id,
    rules,
    startsAt: String(input.startsAt ?? ""),
    now,
    values: {
      pastorName: b.pastor.displayName,
      typeId: b.type.id,
      typeName: b.type.name,
      location: b.type.location,
      address,
      status,
      source,
      memberId,
      identityVerified,
      bookerName: name,
      bookerPhone: phone,
      bookerEmail: email,
      locale: await getLocale(),
      topic,
      manageTokenHash: hashToken(token),
      remindAt:
        status === "confirmed" && !Number.isNaN(startsAtDate.getTime())
          ? remindAtFor(startsAtDate, page.reminderLeadMinutes, zone, now)
          : null,
    },
  });

  if (!claim.ok) {
    const day = Number.isNaN(startsAtDate.getTime()) ? todayKey(now, zone) : todayKey(startsAtDate, zone);
    const fresh = await slotsFor(c, b, day, now);
    return { ok: false, taken: true, error: t("pastoral.public.taken"), slots: fresh.slots };
  }

  const outcome = await afterBooking(c.id, claim.id, { token, toBooker: true, now });
  const when = formatWhen(claim.slot.startsAt, zone, t.intl);
  await auditGuest({
    churchId: c.id,
    guestName: name,
    action: "pastoral.appointment.create",
    summary: `Booked ${b.type.name} with ${b.pastor.displayName} for ${formatWhen(claim.slot.startsAt, zone, "en-GB")}`,
    targetType: "pastoral_appointment",
    targetId: claim.id,
  });

  const where = t(locationKey(b.type.location));
  return {
    ok: true,
    status,
    when,
    zone,
    pastorName: b.pastor.displayName,
    typeName: b.type.name,
    manageUrl: manageUrl(token),
    ics: {
      uid: icsUid(claim.id),
      sequence: 0,
      startsAt: claim.slot.startsAt,
      endsAt: claim.slot.endsAt,
      summary: `${b.type.name} · ${b.pastor.displayName}`,
      location: address ? `${where}, ${address}` : where,
    },
    emailFailed: !!email && /(^|\s)email:failed/.test(outcome),
    smsQueued: /(^|\s)sms:queued@/.test(outcome),
  };
}
