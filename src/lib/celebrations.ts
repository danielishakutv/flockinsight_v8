import "server-only";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, member, celebrationRun, celebrationSetting } from "@/db/schema";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { fillTemplate } from "@/lib/service-reminders";

function nowInTz(tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(hour) * 60 + Number(get("minute")),
  };
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function yearsTo(iso: string | null, currentYear: number): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  const n = currentYear - y;
  return n > 0 ? n : null;
}

const SEND_WINDOW_MIN = 150;

type Event = { kind: string; occasion: string; years: number | null };

function eventsForMember(
  m: {
    dateOfBirth: string | null;
    weddingDate: string | null;
    baptismDate: string | null;
    anniversaries: { label: string; date: string }[] | null;
  },
  mmdd: string,
  year: number,
): Event[] {
  const events: Event[] = [];
  if (m.dateOfBirth && m.dateOfBirth.slice(5) === mmdd)
    events.push({ kind: "birthday", occasion: "birthday", years: null });
  if (m.weddingDate && m.weddingDate.slice(5) === mmdd)
    events.push({
      kind: "wedding",
      occasion: "wedding anniversary",
      years: yearsTo(m.weddingDate, year),
    });
  if (m.baptismDate && m.baptismDate.slice(5) === mmdd)
    events.push({
      kind: "baptism",
      occasion: "baptism anniversary",
      years: yearsTo(m.baptismDate, year),
    });
  for (const a of m.anniversaries ?? [])
    if (a.date && a.date.slice(5) === mmdd)
      events.push({ kind: a.label, occasion: a.label, years: yearsTo(a.date, year) });
  return events;
}

export type CelebrationSummary = {
  churchesChecked: number;
  emails: number;
  sms: number;
};

/**
 * Send birthday & anniversary messages due today. Idempotent per member per
 * occasion per day (celebration_run unique index). Run hourly via cron.
 */
export async function runCelebrations(): Promise<CelebrationSummary> {
  const churches = await db
    .select({
      churchId: celebrationSetting.churchId,
      sms: celebrationSetting.sms,
      email: celebrationSetting.email,
      sendTime: celebrationSetting.sendTime,
      birthdaySms: celebrationSetting.birthdaySms,
      birthdayEmailSubject: celebrationSetting.birthdayEmailSubject,
      birthdayEmailBody: celebrationSetting.birthdayEmailBody,
      anniversarySms: celebrationSetting.anniversarySms,
      anniversaryEmailSubject: celebrationSetting.anniversaryEmailSubject,
      anniversaryEmailBody: celebrationSetting.anniversaryEmailBody,
      name: church.name,
      timezone: church.timezone,
    })
    .from(celebrationSetting)
    .innerJoin(church, eq(church.id, celebrationSetting.churchId))
    .where(
      and(eq(celebrationSetting.enabled, true), eq(church.status, "active")),
    );

  const summary: CelebrationSummary = {
    churchesChecked: churches.length,
    emails: 0,
    sms: 0,
  };

  for (const c of churches) {
    if (!c.sms && !c.email) continue;
    const local = nowInTz(c.timezone || "Africa/Lagos");
    const sendMin = toMinutes(c.sendTime);
    if (local.minutes < sendMin || local.minutes - sendMin > SEND_WINDOW_MIN)
      continue;

    const today = local.date;
    const mmdd = today.slice(5);
    const year = Number(today.slice(0, 4));

    const members = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
        dateOfBirth: member.dateOfBirth,
        weddingDate: member.weddingDate,
        baptismDate: member.baptismDate,
        anniversaries: member.anniversaries,
      })
      .from(member)
      .where(
        and(
          eq(member.churchId, c.churchId),
          or(
            eq(sql`to_char(${member.dateOfBirth}, 'MM-DD')`, mmdd),
            eq(sql`to_char(${member.weddingDate}, 'MM-DD')`, mmdd),
            eq(sql`to_char(${member.baptismDate}, 'MM-DD')`, mmdd),
            ne(sql`jsonb_array_length(${member.anniversaries})`, 0),
          ),
        ),
      )
      .limit(2000);

    const smsRecipients: { phone: string; message: string }[] = [];
    const emailJobs: { to: string; subject: string; body: string }[] = [];

    for (const m of members) {
      const events = eventsForMember(m, mmdd, year);
      for (const ev of events) {
        const [run] = await db
          .insert(celebrationRun)
          .values({ churchId: c.churchId, memberId: m.id, kind: ev.kind, onDate: today })
          .onConflictDoNothing()
          .returning({ id: celebrationRun.id });
        if (!run) continue;

        const isBirthday = ev.kind === "birthday";
        const vars = {
          name: m.firstName,
          church: c.name,
          occasion: ev.occasion,
          years: ev.years ? String(ev.years) : "",
        };
        if (c.sms && m.phone)
          smsRecipients.push({
            phone: m.phone,
            message: fillTemplate(isBirthday ? c.birthdaySms : c.anniversarySms, vars),
          });
        if (c.email && m.email)
          emailJobs.push({
            to: m.email,
            subject: fillTemplate(
              isBirthday ? c.birthdayEmailSubject : c.anniversaryEmailSubject,
              vars,
            ),
            body: fillTemplate(
              isBirthday ? c.birthdayEmailBody : c.anniversaryEmailBody,
              vars,
            ),
          });
      }
    }

    let emails = 0;
    for (const job of emailJobs) {
      try {
        const ok = await sendEmail({
          to: job.to,
          subject: job.subject,
          html: emailLayout(job.subject, job.body.replace(/\n/g, "<br>")),
          text: job.body,
        });
        if (ok) emails++;
      } catch {
        /* keep going */
      }
    }
    if (emails > 0) await recordUsage("email", c.churchId, emails);
    summary.emails += emails;

    if (smsRecipients.length) {
      const res = await sendChurchSmsBatch({
        churchId: c.churchId,
        recipients: smsRecipients,
        label: "Birthday & anniversary wishes",
      });
      if (res.ok) summary.sms += res.sent;
    }
  }

  return summary;
}

export type QueueItem = {
  id: string;
  name: string;
  kind: string;
  label: string; // occasion
  dateLabel: string;
  offset: number;
  years: number | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Upcoming birthdays + anniversaries for the next `days` days (for preview). */
export async function getCelebrationQueue(
  churchId: string,
  days = 14,
): Promise<QueueItem[]> {
  const today = new Date();
  const win = new Map<string, { offset: number; label: string; year: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    win.set(key, {
      offset: i,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${MONTHS[d.getMonth()]} ${d.getDate()}`,
      year: d.getFullYear(),
    });
  }

  const rows = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      dateOfBirth: member.dateOfBirth,
      weddingDate: member.weddingDate,
      baptismDate: member.baptismDate,
      anniversaries: member.anniversaries,
    })
    .from(member)
    .where(
      and(
        eq(member.churchId, churchId),
        or(
          isNotNull(member.dateOfBirth),
          isNotNull(member.weddingDate),
          isNotNull(member.baptismDate),
          ne(sql`jsonb_array_length(${member.anniversaries})`, 0),
        ),
      ),
    )
    .limit(2000);

  const items: QueueItem[] = [];
  const add = (
    r: (typeof rows)[number],
    iso: string | null,
    kind: string,
    occasion: string,
  ) => {
    if (!iso) return;
    const w = win.get(iso.slice(5));
    if (!w) return;
    items.push({
      id: `${r.id}-${kind}`,
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      kind,
      label: occasion,
      dateLabel: w.label,
      offset: w.offset,
      years: yearsTo(iso, w.year),
    });
  };
  for (const r of rows) {
    add(r, r.dateOfBirth, "birthday", "Birthday");
    add(r, r.weddingDate, "wedding", "Wedding anniversary");
    add(r, r.baptismDate, "baptism", "Baptism anniversary");
    for (const a of r.anniversaries ?? []) add(r, a.date, a.label, a.label);
  }
  return items.sort((a, b) => a.offset - b.offset).slice(0, 40);
}
