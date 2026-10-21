/**
 * Every message a booking sends, as text, with nothing sent from here.
 *
 * Pure apart from the dictionaries: takes a `t` and the facts, returns
 * strings. No request is needed, so the reminder cron builds exactly what the
 * booking page built, in the language the booker used.
 *
 * Two rules every builder keeps:
 *   - What the appointment is ABOUT (the topic) is never a parameter here, so
 *     no SMS, email or calendar file can carry it, whatever a caller passes.
 *   - Anything a stranger typed or a church entered goes through escapeHtml
 *     before it touches HTML. A booker named `<script>` is a booker named
 *     `<script>` in the email, not a script.
 */

import { localeForCountry } from "@/lib/country-profile";
import { escapeHtml } from "@/lib/html-escape";
import { en, mergedDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, type LocaleCode } from "@/lib/i18n/locales";
import { makeT, type TFunction } from "@/lib/i18n/translate";
import { emailLayout } from "@/lib/mailer";
import { instantFromWallClock, wallClockIn } from "@/lib/meeting-recurrence";
import { localHour, nextSmsWindowStart, withinSmsWindow } from "@/lib/sms-window";

/* ============================================================
 * Which language
 * ========================================================== */

/**
 * The booker's own language when the page recorded one, else the church's
 * default, else its country's. Staff bookings have no locale, so they read
 * the church's.
 */
export function messageLocale(
  appt: { locale?: string | null },
  church: { defaultLocale?: string | null; country?: string | null },
): LocaleCode {
  if (isLocale(appt.locale)) return appt.locale;
  if (isLocale(church.defaultLocale)) return church.defaultLocale;
  return localeForCountry(church.country);
}

export function messageT(locale: LocaleCode): TFunction {
  return makeT(locale, mergedDictionary(locale), en);
}

/** "Tue 3 Nov, 09:30" in the church's zone, in the reader's language. */
export function formatWhen(at: Date | string, timeZone: string, intl: string): string {
  const d = at instanceof Date ? at : new Date(at);
  try {
    return new Intl.DateTimeFormat(intl, {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch (e) {
    // An unknown locale tag or zone must not stop a confirmation going out.
    console.error("[pastoral-messages] could not format a time; using UTC", e);
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

/* ============================================================
 * When a text may go
 * ========================================================== */

const HALF_HOUR = 30 * 60_000;

/**
 * Send now, queue for the morning, or skip.
 *
 * Skip when the earliest a text could go is less than half an hour before
 * the appointment: a text that can only arrive after somebody has sat down
 * with their pastor is money spent on nothing. "send" and "queue" both go
 * through sendChurchSms's own "queue" timing, which re-checks the window.
 */
export function smsTiming(now: Date, startsAt: Date, timeZone: string): "send" | "queue" | "skip" {
  if (withinSmsWindow(now, timeZone)) {
    return startsAt.getTime() > now.getTime() ? "send" : "skip";
  }
  return nextSmsWindowStart(now, timeZone).getTime() <= startsAt.getTime() - HALF_HOUR
    ? "queue"
    : "skip";
}

/**
 * When the reminder is due, already inside the 8am-8pm text window.
 *
 * Aims for `leadMinutes` before. A target at 20:00 or later moves to 19:00
 * the same local day; one before 08:00 moves to 19:00 the day before. Always
 * EARLIER, never later, and 19:00 leaves an hour for a late tick. Null when
 * that lands within half an hour of now: a late booking has just had its
 * confirmation, and that is its reminder.
 */
export function remindAtFor(
  startsAt: Date,
  leadMinutes: number,
  timeZone: string,
  now: Date,
): Date | null {
  const target = new Date(startsAt.getTime() - leadMinutes * 60_000);
  const hour = localHour(target, timeZone);
  let at = target;
  if (hour >= 20 || hour < 8) {
    const w = wallClockIn(target, timeZone);
    let { year, month, day } = w;
    if (hour < 8) {
      const prev = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
      year = prev.getUTCFullYear();
      month = prev.getUTCMonth() + 1;
      day = prev.getUTCDate();
    }
    at = instantFromWallClock({ year, month, day, hour: 19, minute: 0 }, timeZone);
  }
  if (at.getTime() < now.getTime() + HALF_HOUR) return null;
  return at;
}

/* ============================================================
 * The facts every message is built from
 * ========================================================== */

export type MessageFacts = {
  church: string;
  type: string;
  pastor: string;
  when: string;
  /** The manage link. Empty where a message carries none. */
  link: string;
  bookerName: string;
  /** Already translated: "At the church", "Home visit"... */
  location: string;
  address?: string | null;
  /** Said to the booker on a decline or a staff cancellation. */
  note?: string | null;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/* ---------------- SMS: no HTML, no topic, the link last ---------------- */

export function smsConfirmed(t: TFunction, f: MessageFacts): string {
  return squash(t("pastoral.msg.smsConfirmed", { church: f.church, type: f.type, pastor: f.pastor, when: f.when, link: f.link }));
}
export function smsPending(t: TFunction, f: MessageFacts): string {
  return squash(t("pastoral.msg.smsPending", { church: f.church, type: f.type, pastor: f.pastor, when: f.when, link: f.link }));
}
export function smsReminder(t: TFunction, f: MessageFacts): string {
  return squash(t("pastoral.msg.smsReminder", { church: f.church, type: f.type, pastor: f.pastor, when: f.when, link: f.link }));
}
export function smsCancelled(t: TFunction, f: MessageFacts): string {
  return squash(
    t("pastoral.msg.smsCancelled", {
      church: f.church,
      type: f.type,
      pastor: f.pastor,
      when: f.when,
      note: (f.note ?? "").slice(0, 160),
    }),
  );
}
export function smsMoved(t: TFunction, f: MessageFacts): string {
  return squash(t("pastoral.msg.smsMoved", { church: f.church, type: f.type, pastor: f.pastor, when: f.when, link: f.link }));
}

/* ---------------- Email ---------------- */

export type EmailKind = "confirmed" | "pending" | "reminder" | "cancelled" | "declined" | "moved";

export type BuiltEmail = { subject: string; html: string; text: string };

/**
 * One email to the booker. Every value that came from a person is escaped
 * here, once, and the text part is built from the unescaped values.
 */
export function bookerEmail(t: TFunction, kind: EmailKind, f: MessageFacts): BuiltEmail {
  const vars = { type: f.type, pastor: f.pastor, when: f.when };
  const subject = squash(
    {
      confirmed: t("pastoral.msg.emailConfirmedSubject", vars),
      pending: t("pastoral.msg.emailPendingSubject", vars),
      reminder: t("pastoral.msg.emailReminderSubject", vars),
      cancelled: t("pastoral.msg.emailCancelledSubject", vars),
      declined: t("pastoral.msg.emailDeclinedSubject", vars),
      moved: t("pastoral.msg.emailMovedSubject", vars),
    }[kind],
  );
  const lead = {
    confirmed: t("pastoral.msg.emailConfirmedBody", vars),
    pending: t("pastoral.msg.emailPendingBody", vars),
    reminder: t("pastoral.msg.emailReminderBody", vars),
    cancelled: t("pastoral.msg.emailCancelledBody", vars),
    declined: t("pastoral.msg.emailDeclinedBody", vars),
    moved: t("pastoral.msg.emailMovedBody", vars),
  }[kind];

  const live = kind !== "cancelled" && kind !== "declined";
  const rows: [string, string][] = [
    [t("pastoral.msg.labelWhen"), f.when],
    [t("pastoral.msg.labelWith"), f.pastor],
    [t("pastoral.msg.labelWhere"), f.location],
  ];
  if (f.address) rows.push([t("pastoral.msg.labelAddress"), f.address]);

  const hello = t("pastoral.msg.emailHello", { name: f.bookerName });
  const note = f.note?.trim() ? f.note.trim() : null;
  const tail = live
    ? f.link
      ? t("pastoral.msg.emailLinkHint")
      : ""
    : t("pastoral.msg.emailRebookHint");
  const calendar = kind === "confirmed" || kind === "moved" ? t("pastoral.msg.emailCalendarHint") : "";

  const html =
    `<p>${escapeHtml(hello)}</p>` +
    `<p>${escapeHtml(lead)}</p>` +
    (live
      ? `<table style="border-collapse:collapse;margin:12px 0">${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:2px 12px 2px 0;color:#8a86a0">${escapeHtml(k)}</td><td style="padding:2px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
          )
          .join("")}</table>`
      : "") +
    (note
      ? `<p><b>${escapeHtml(t("pastoral.msg.labelNote"))}:</b> ${escapeHtml(note).replace(/\n/g, "<br>")}</p>`
      : "") +
    (calendar ? `<p>${escapeHtml(calendar)}</p>` : "") +
    (tail ? `<p>${escapeHtml(tail)}</p>` : "") +
    `<p>${escapeHtml(f.church)}</p>`;

  const text = [
    hello,
    "",
    lead,
    ...(live ? ["", ...rows.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(note ? ["", `${t("pastoral.msg.labelNote")}: ${note}`] : []),
    ...(calendar ? ["", calendar] : []),
    ...(tail ? ["", tail] : []),
    ...(live && f.link ? [f.link] : []),
    "",
    f.church,
  ].join("\n");

  return {
    subject,
    html: emailLayout(
      escapeHtml(subject),
      html,
      live && f.link ? { label: escapeHtml(t("pastoral.msg.manageCta")), url: escapeHtml(f.link) } : undefined,
    ),
    text,
  };
}

export type PastorEmailKind = "new" | "pending" | "cancelled" | "moved";

/** What the pastor is told, in-app and by email. Never the topic. */
export function pastorNotice(
  t: TFunction,
  kind: PastorEmailKind,
  f: Pick<MessageFacts, "type" | "when" | "bookerName">,
): { title: string; body: string } {
  const vars = { type: f.type, when: f.when, booker: f.bookerName };
  switch (kind) {
    case "pending":
      return { title: t("pastoral.msg.pastorPendingTitle", vars), body: t("pastoral.msg.pastorNewBody", vars) };
    case "cancelled":
      return { title: t("pastoral.msg.pastorCancelledTitle", vars), body: t("pastoral.msg.pastorCancelledBody", vars) };
    case "moved":
      return { title: t("pastoral.msg.pastorMovedTitle", vars), body: t("pastoral.msg.pastorMovedBody", vars) };
    default:
      return { title: t("pastoral.msg.pastorNewTitle", vars), body: t("pastoral.msg.pastorNewBody", vars) };
  }
}

export function pastorEmail(
  t: TFunction,
  kind: PastorEmailKind,
  f: Pick<MessageFacts, "type" | "when" | "bookerName" | "location" | "address">,
  diaryUrl: string,
): BuiltEmail {
  const n = pastorNotice(t, kind, f);
  const extra = [f.location, f.address].filter(Boolean).join(" · ");
  const html =
    `<p>${escapeHtml(n.body)}</p>` + (extra ? `<p>${escapeHtml(extra)}</p>` : "");
  return {
    subject: squash(n.title),
    html: emailLayout(escapeHtml(n.title), html, {
      label: escapeHtml(t("pastoral.msg.pastorOpenDiary")),
      url: escapeHtml(diaryUrl),
    }),
    text: [n.body, extra, "", diaryUrl].filter((x, i) => x || i > 1).join("\n"),
  };
}
