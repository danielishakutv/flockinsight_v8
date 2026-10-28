import "server-only";
import { rowHasFeature } from "@/lib/plan-catalog";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, otpCode, pastorProfile, user } from "@/db/schema";
import { smsAvailableForCountry } from "@/lib/country-profile";
import type { TFunction } from "@/lib/i18n/translate";
import { isEmailConfigured, sendEmailWithId, type EmailAttachment } from "@/lib/mailer";
import { notifyUser } from "@/lib/notifications";
import { issueOtp } from "@/lib/otp";
import {
  getAppointment,
  getBookingPage,
  manageUrl,
  recordOutcome,
  rotateManageHash,
  type AppointmentRow,
  type BookingPageRow,
} from "@/lib/pastoral";
import { buildIcs, icsUid, type IcsMethod } from "@/lib/pastoral-ics";
import {
  bookerEmail,
  formatWhen,
  messageLocale,
  messageT,
  pastorEmail,
  pastorNotice,
  smsCancelled,
  smsConfirmed,
  smsMoved,
  smsPending,
  smsReminder,
  smsTiming,
  type EmailKind,
  type MessageFacts,
  type PastorEmailKind,
} from "@/lib/pastoral-messages";
import {
  anyDelivered,
  churchZone,
  failedToken,
  formatOutcome,
  locationKey,
  type DeliveryToken,
} from "@/lib/pastoral-shared";
import { hashToken, newManageToken } from "@/lib/pastoral-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site";

/**
 * Everything a booking tells anybody, and what happened when it tried.
 *
 * Never throws. Every send is caught, logged with the appointment id and
 * recorded as `failed:<reason>` on the appointment, where the diary shows it,
 * because a confirmation that silently never arrived is how somebody waits at
 * the church door for a pastor who does not know they are coming.
 *
 * Texts are gated HERE on the `sms` plan feature (Pro). sendChurchSms checks
 * the country, the sender, the window and the wallet, but not the plan, so
 * without this a Growth church with an approved sender would be texting.
 *
 * The topic is never read in this file.
 */

export const PASTORAL_OTP_PURPOSE = "pastoral_booking";

/** Texts one church's booking messages may send in an hour, whatever triggers them. */
const SMS_PER_CHURCH_PER_HOUR = 120;

type NotifyChurch = {
  id: string;
  name: string;
  timezone: string;
  country: string;
  publicEmail: string | null;
  publicPhone: string | null;
  defaultLocale: string | null;
  plan: string;
  customPlanId: string | null;
  slug: string;
  isDemo: boolean;
};

type Ctx = {
  appt: AppointmentRow;
  church: NotifyChurch;
  page: BookingPageRow | null;
  zone: string;
  /** In the booker's language. */
  t: TFunction;
  /** In the church's language, for the pastor. */
  staffT: TFunction;
};

async function loadCtx(id: string, churchId: string): Promise<Ctx | null> {
  const [c] = await db
    .select({
      id: church.id,
      name: church.name,
      timezone: church.timezone,
      country: church.country,
      publicEmail: church.publicEmail,
      publicPhone: church.publicPhone,
      defaultLocale: church.defaultLocale,
      plan: church.plan,
      customPlanId: church.customPlanId,
      slug: church.slug,
      isDemo: church.isDemo,
    })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c) return null;
  const appt = await getAppointment(c.id, id);
  if (!appt) return null;
  return {
    appt,
    church: c,
    page: await getBookingPage(c.id),
    zone: churchZone(c),
    t: messageT(messageLocale(appt, c)),
    staffT: messageT(messageLocale({}, c)),
  };
}

function factsFor(ctx: Ctx, t: TFunction, link: string, note?: string | null): MessageFacts {
  const a = ctx.appt;
  return {
    church: ctx.church.name,
    type: a.typeName,
    pastor: a.pastorName,
    when: formatWhen(a.startsAt, ctx.zone, t.intl),
    link,
    bookerName: a.bookerName,
    location: t(locationKey(a.location)),
    address: a.address,
    note: note ?? null,
  };
}

function icsFor(ctx: Ctx, t: TFunction, method: IcsMethod, forPastor: boolean): EmailAttachment {
  const a = ctx.appt;
  const where = t(locationKey(a.location));
  const body = buildIcs({
    uid: icsUid(a.id),
    sequence: a.rescheduleCount,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    summary: forPastor ? `${a.typeName}: ${a.bookerName}` : `${a.typeName} · ${a.pastorName}`,
    location: a.address ? `${where}, ${a.address}` : where,
    description: where,
    method,
  });
  return {
    filename: "appointment.ics",
    content: Buffer.from(body, "utf8"),
    contentType: `text/calendar; charset=utf-8; method=${method}`,
  };
}

/* ------------------------------------------------------------------ *
 * The booker
 * ------------------------------------------------------------------ */

async function emailBooker(
  ctx: Ctx,
  kind: EmailKind,
  facts: MessageFacts,
  ics: IcsMethod | null,
): Promise<DeliveryToken | null> {
  const to = ctx.appt.bookerEmail;
  if (!to) return null;
  if (!ctx.page?.emailBooker) return "off";
  if (!isEmailConfigured()) return failedToken("email is not set up on the platform");
  try {
    const built = bookerEmail(ctx.t, kind, facts);
    const res = await sendEmailWithId({
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      fromName: ctx.church.name,
      replyTo: ctx.church.publicEmail ?? undefined,
      attachments: ics ? [icsFor(ctx, ctx.t, ics, false)] : undefined,
    });
    if (res.ok) return "sent";
    console.error(`[pastoral-notify] booker email refused for appointment ${ctx.appt.id}: ${res.error ?? "no reason given"}`);
    return failedToken(res.error ?? "not accepted");
  } catch (e) {
    console.error(`[pastoral-notify] booker email threw for appointment ${ctx.appt.id}`, e);
    return failedToken("email error");
  }
}

async function smsBooker(ctx: Ctx, message: string, now: Date): Promise<DeliveryToken | null> {
  const to = ctx.appt.bookerPhone;
  if (!to) return null;
  if (!ctx.page?.smsBooker) return "off";
  if (!(await rowHasFeature(ctx.church, "sms"))) return "noplan";
  if (!smsAvailableForCountry(ctx.church.country)) return failedToken("texts are not available in this country");
  if (smsTiming(now, ctx.appt.startsAt, ctx.church.timezone) === "skip") return "skipped";
  if (!rateLimit(`pastoral-sms:${ctx.church.id}`, SMS_PER_CHURCH_PER_HOUR, 60 * 60_000).ok)
    return failedToken("hourly text limit reached");
  try {
    const { sendChurchSms } = await import("@/lib/church-sms");
    const res = await sendChurchSms({
      churchId: ctx.church.id,
      to,
      message,
      // Generic on purpose: the wallet ledger is read by the treasurer, and a
      // line naming "Counselling" with a name beside it is pastoral detail.
      reason: "Pastoral appointment text",
      origin: "pastoral",
      audience: "Pastoral appointment",
    });
    if (res.ok === true) return "sent";
    if (res.ok === "queued") return `queued@${res.sendAfter.toISOString()}`;
    // `uncertain` may have gone, so it is never retried; recorded as failed.
    console.error(`[pastoral-notify] text not sent for appointment ${ctx.appt.id}: ${res.error}`);
    return failedToken(res.uncertain ? "uncertain" : res.error);
  } catch (e) {
    console.error(`[pastoral-notify] text threw for appointment ${ctx.appt.id}`, e);
    return failedToken("text error");
  }
}

/**
 * Send something that carries a manage link, with a FRESH link.
 *
 * Only the hash of a token is stored, so a message sent later (a staff
 * confirmation, the reminder) cannot repeat the original link. It mints a new
 * one, and the new hash replaces the old ONLY if at least one channel sent or
 * queued it. If every send failed, the link the booker already holds keeps
 * working.
 */
async function withFreshLink(ctx: Ctx, send: (link: string) => Promise<string>): Promise<string> {
  const token = newManageToken();
  const outcome = await send(manageUrl(token));
  if (anyDelivered(outcome)) {
    const rotated = await rotateManageHash(ctx.appt.id, ctx.appt.manageTokenHash, hashToken(token));
    if (!rotated)
      console.error(
        `[pastoral-notify] appointment ${ctx.appt.id} changed while a message was going out; the link in that message will not work`,
      );
  }
  return outcome;
}

/* ------------------------------------------------------------------ *
 * The pastor
 * ------------------------------------------------------------------ */

/**
 * Tell the pastor. Caught here rather than by `safely`: the booker's outcome
 * has already been recorded by then, and a failed in-app notice must not be
 * reported to the booker as "we couldn't send your confirmation email".
 */
async function tellPastor(
  ctx: Ctx,
  kind: PastorEmailKind,
  ics: IcsMethod | null,
  opts: { skipUserId?: string } = {},
): Promise<void> {
  try {
    await tellPastorUnsafe(ctx, kind, ics, opts);
  } catch (e) {
    console.error(`[pastoral-notify] could not tell the pastor about appointment ${ctx.appt.id}`, e);
  }
}

async function tellPastorUnsafe(
  ctx: Ctx,
  kind: PastorEmailKind,
  ics: IcsMethod | null,
  opts: { skipUserId?: string },
): Promise<void> {
  if (!ctx.appt.pastorId) return;
  const [p] = await db
    .select({ userId: pastorProfile.userId, email: user.email })
    .from(pastorProfile)
    .leftJoin(user, eq(user.id, pastorProfile.userId))
    .where(and(eq(pastorProfile.id, ctx.appt.pastorId), eq(pastorProfile.churchId, ctx.church.id)))
    .limit(1);
  if (!p || p.userId === opts.skipUserId) return;

  const t = ctx.staffT;
  const facts = factsFor(ctx, t, "");
  const n = pastorNotice(t, kind, facts);
  await notifyUser({ userId: p.userId, title: n.title, body: n.body, linkUrl: "/appointments" });

  if (!ctx.page?.notifyPastorByEmail || !p.email || !isEmailConfigured()) return;
  try {
    const built = pastorEmail(t, kind, facts, `${siteUrl()}/appointments`);
    const res = await sendEmailWithId({
      to: p.email,
      subject: built.subject,
      html: built.html,
      text: built.text,
      fromName: ctx.church.name,
      attachments: ics ? [icsFor(ctx, t, ics, true)] : undefined,
    });
    if (!res.ok)
      console.error(`[pastoral-notify] pastor email refused for appointment ${ctx.appt.id}: ${res.error ?? "no reason given"}`);
  } catch (e) {
    console.error(`[pastoral-notify] pastor email threw for appointment ${ctx.appt.id}`, e);
  }
}

/* ------------------------------------------------------------------ *
 * One entry point per event
 * ------------------------------------------------------------------ */

async function safely(what: string, id: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[pastoral-notify] ${what} failed for appointment ${id}`, e);
    return formatOutcome({ email: failedToken("could not send") });
  }
}

/**
 * A new booking: confirmation (or "request received") to the booker with the
 * link they were just shown, and the pastor told. `toBooker` false is a staff
 * booking whose confirmation was switched off.
 */
export async function afterBooking(
  churchId: string,
  id: string,
  opts: { token: string; toBooker: boolean; now?: Date; actorUserId?: string },
): Promise<string> {
  return safely("afterBooking", id, async () => {
    const ctx = await loadCtx(id, churchId);
    if (!ctx) return "";
    const now = opts.now ?? new Date();
    const pending = ctx.appt.status === "pending";
    let outcome = "";
    if (opts.toBooker) {
      const facts = factsFor(ctx, ctx.t, manageUrl(opts.token));
      const email = await emailBooker(ctx, pending ? "pending" : "confirmed", facts, pending ? null : "REQUEST");
      const sms = await smsBooker(ctx, pending ? smsPending(ctx.t, facts) : smsConfirmed(ctx.t, facts), now);
      outcome = formatOutcome({ ...(email ? { email } : {}), ...(sms ? { sms } : {}) });
    } else {
      outcome = formatOutcome({ ...(ctx.appt.bookerEmail ? { email: "off" } : {}), ...(ctx.appt.bookerPhone ? { sms: "off" } : {}) });
    }
    await recordOutcome(id, "confirmation", outcome);
    await tellPastor(ctx, pending ? "pending" : "new", pending ? null : "REQUEST", { skipUserId: opts.actorUserId });
    return outcome;
  });
}

/** A pending request confirmed by the pastor or a manager. */
export async function afterConfirm(churchId: string, id: string, now = new Date()): Promise<string> {
  return safely("afterConfirm", id, async () => {
    const ctx = await loadCtx(id, churchId);
    if (!ctx) return "";
    const outcome = await withFreshLink(ctx, async (link) => {
      const facts = factsFor(ctx, ctx.t, link);
      const email = await emailBooker(ctx, "confirmed", facts, "REQUEST");
      const sms = await smsBooker(ctx, smsConfirmed(ctx.t, facts), now);
      return formatOutcome({ ...(email ? { email } : {}), ...(sms ? { sms } : {}) });
    });
    await recordOutcome(id, "confirmation", outcome);
    return outcome;
  });
}

/** A request turned down, with the reason said to the booker. */
export async function afterDecline(churchId: string, id: string, now = new Date()): Promise<string> {
  return safely("afterDecline", id, async () => {
    const ctx = await loadCtx(id, churchId);
    if (!ctx) return "";
    const facts = factsFor(ctx, ctx.t, "", ctx.appt.decisionNote);
    const email = await emailBooker(ctx, "declined", facts, null);
    const sms = await smsBooker(
      ctx,
      ctx.t("pastoral.msg.smsDeclined", { church: facts.church, pastor: facts.pastor, when: facts.when, note: (facts.note ?? "").slice(0, 160) }).replace(/\s+/g, " ").trim(),
      now,
    );
    const outcome = formatOutcome({ ...(email ? { email } : {}), ...(sms ? { sms } : {}) });
    await recordOutcome(id, "confirmation", outcome);
    return outcome;
  });
}

/**
 * A cancellation. By staff: the booker is told by email and text. By the
 * booker: an email receipt only (a paid text to say what they just did is
 * money spent on nothing), and the pastor is told with a calendar CANCEL.
 */
export async function afterCancel(
  churchId: string,
  id: string,
  by: "booker" | "staff",
  opts: { now?: Date; actorUserId?: string } = {},
): Promise<string> {
  return safely("afterCancel", id, async () => {
    const ctx = await loadCtx(id, churchId);
    if (!ctx) return "";
    const facts = factsFor(ctx, ctx.t, "", by === "staff" ? ctx.appt.decisionNote : null);
    const email = await emailBooker(ctx, "cancelled", facts, "CANCEL");
    const sms = by === "staff" ? await smsBooker(ctx, smsCancelled(ctx.t, facts), opts.now ?? new Date()) : null;
    const outcome = formatOutcome({ ...(email ? { email } : {}), ...(sms ? { sms } : {}) });
    await recordOutcome(id, "confirmation", outcome);
    await tellPastor(ctx, "cancelled", "CANCEL", { skipUserId: opts.actorUserId });
    return outcome;
  });
}

/** A move, with the new link the move just minted. */
export async function afterReschedule(
  churchId: string,
  id: string,
  opts: { token: string; toBooker: boolean; now?: Date; actorUserId?: string },
): Promise<string> {
  return safely("afterReschedule", id, async () => {
    const ctx = await loadCtx(id, churchId);
    if (!ctx) return "";
    const pending = ctx.appt.status === "pending";
    let outcome = formatOutcome({});
    if (opts.toBooker) {
      const facts = factsFor(ctx, ctx.t, manageUrl(opts.token));
      const email = await emailBooker(ctx, pending ? "pending" : "moved", facts, pending ? null : "REQUEST");
      const sms = await smsBooker(ctx, pending ? smsPending(ctx.t, facts) : smsMoved(ctx.t, facts), opts.now ?? new Date());
      outcome = formatOutcome({ ...(email ? { email } : {}), ...(sms ? { sms } : {}) });
      await recordOutcome(id, "confirmation", outcome);
    }
    await tellPastor(ctx, pending ? "pending" : "moved", "REQUEST", { skipUserId: opts.actorUserId });
    return outcome;
  });
}

/** The reminder, with a fresh link. Used by the cron after it has claimed the row. */
export async function sendReminder(churchId: string, id: string, now = new Date()): Promise<string> {
  return safely("sendReminder", id, async () => {
    const ctx = await loadCtx(id, churchId);
    if (!ctx) return "";
    const outcome = await withFreshLink(ctx, async (link) => {
      const facts = factsFor(ctx, ctx.t, link);
      const email = await emailBooker(ctx, "reminder", facts, null);
      const sms = await smsBooker(ctx, smsReminder(ctx.t, facts), now);
      return formatOutcome({ ...(email ? { email } : {}), ...(sms ? { sms } : {}) });
    });
    await recordOutcome(id, "reminder", outcome);
    return outcome;
  });
}

/* ------------------------------------------------------------------ *
 * Members-only codes
 * ------------------------------------------------------------------ */

/**
 * Send a one-time code to a member, to the email or phone the church has ON
 * FILE (never one typed on the page). The sendSignupOtp pattern with its own
 * purpose and wording: email first; an undelivered email code is retired so it
 * does not count against the live-codes limit; SMS only on Pro, and timed
 * "refuse", because a code that waits until 8am is dead when it arrives.
 */
export async function sendBookingCode(opts: {
  church: {
    id: string;
    name: string;
    plan: string;
    customPlanId: string | null;
    slug: string;
    isDemo: boolean;
  };
  member: { id: string; email: string | null; phone: string | null };
  t: TFunction;
}): Promise<{ ok: true; otpId: string } | { ok: false; error: string }> {
  const { church: c, member: m, t } = opts;
  const email = m.email?.trim().toLowerCase() || null;
  const phone = m.phone?.trim() || null;

  if (email && isEmailConfigured()) {
    const issued = await issueOtp({
      churchId: c.id,
      purpose: PASTORAL_OTP_PURPOSE,
      channel: "email",
      destination: email,
      memberId: m.id,
    });
    if (!issued.ok) return { ok: false, error: issued.error };
    const subject = t("pastoral.msg.codeSubject", { church: c.name });
    const body = t("pastoral.msg.codeBody", { church: c.name, code: issued.code });
    let sent = false;
    try {
      const { emailLayout } = await import("@/lib/mailer");
      const { escapeHtml } = await import("@/lib/html-escape");
      const res = await sendEmailWithId({
        to: email,
        subject,
        html: emailLayout(
          escapeHtml(subject),
          `${escapeHtml(body)}<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:12px 0">${issued.code}</div>`,
        ),
        text: body,
        fromName: c.name,
      });
      sent = res.ok;
      if (!res.ok) console.error(`[pastoral-notify] booking code email refused for member ${m.id}: ${res.error ?? "no reason given"}`);
    } catch (e) {
      console.error(`[pastoral-notify] booking code email threw for member ${m.id}`, e);
    }
    if (sent) return { ok: true, otpId: issued.id };
    // Retire the undelivered code before trying the phone.
    await db.update(otpCode).set({ consumedAt: new Date() }).where(eq(otpCode.id, issued.id));
  }

  if (phone && (await rowHasFeature(c, "sms"))) {
    const issued = await issueOtp({
      churchId: c.id,
      purpose: PASTORAL_OTP_PURPOSE,
      channel: "sms",
      destination: phone.replace(/\D/g, ""),
      memberId: m.id,
    });
    if (!issued.ok) return { ok: false, error: issued.error };
    const { sendChurchSms } = await import("@/lib/church-sms");
    const res = await sendChurchSms({
      churchId: c.id,
      to: phone,
      message: t("pastoral.msg.codeBody", { church: c.name, code: issued.code }),
      reason: "Pastoral booking verification",
      timing: "refuse",
      origin: "pastoral",
    });
    if (res.ok === true) return { ok: true, otpId: issued.id };
    const why = res.ok === "queued" ? "queued unexpectedly" : res.error;
    console.error(`[pastoral-notify] booking code text not sent for member ${m.id}: ${why}`);
    return { ok: false, error: why };
  }

  return { ok: false, error: "no deliverable email or phone on file" };
}
