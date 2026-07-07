"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { event, eventGuest } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { smsAvailableForCountry } from "@/lib/sms-availability";

export type ActionResult = { ok: true } | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const guestSchema = z.object({
  id: z.string().uuid().optional(),
  eventId: z.string().uuid(),
  name: z.string().trim().min(1, "Add a name").max(120),
  role: z.string().trim().min(1).max(60).default("Guest"),
  email: z.preprocess(
    emptyToNull,
    z.string().trim().email("Invalid email").max(160).nullable(),
  ),
  phone: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
  note: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()).optional(),
});

export type EventGuestInput = z.input<typeof guestSchema>;

/** Verify an event belongs to the active church. */
async function ownsEvent(eventId: string, churchId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.churchId, churchId)))
    .limit(1);
  return !!row;
}

export async function saveEventGuest(input: EventGuestInput): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const parsed = guestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  if (!d.email && !d.phone)
    return { ok: false, error: "Add an email or phone number for the guest." };
  if (!(await ownsEvent(d.eventId, church.id)))
    return { ok: false, error: "Event not found." };

  const fields = {
    name: d.name,
    role: d.role,
    email: d.email,
    phone: d.phone,
    note: d.note ?? null,
  };
  if (d.id) {
    await db
      .update(eventGuest)
      .set(fields)
      .where(and(eq(eventGuest.id, d.id), eq(eventGuest.churchId, church.id)));
  } else {
    await db
      .insert(eventGuest)
      .values({ eventId: d.eventId, churchId: church.id, ...fields });
  }
  revalidatePath("/my-events");
  return { ok: true };
}

export async function deleteEventGuest(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db
    .delete(eventGuest)
    .where(and(eq(eventGuest.id, id), eq(eventGuest.churchId, church.id)));
  revalidatePath("/my-events");
  return { ok: true };
}

const messageSchema = z.object({
  eventId: z.string().uuid(),
  channel: z.enum(["sms", "email"]),
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1, "Write a message").max(2000),
  guestIds: z.array(z.string().uuid()).default([]),
});

export type MessageGuestsResult =
  | { ok: true; sent: number; failed: number; cost?: number }
  | { ok: false; error: string };

function fill(text: string, name: string, eventTitle: string, churchName: string) {
  return text
    .replace(/\{name\}/g, name || "there")
    .replace(/\{event\}/g, eventTitle)
    .replace(/\{church\}/g, churchName);
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Email or SMS an event's guests (all, or a chosen subset). Sends immediately. */
export async function messageEventGuests(
  input: z.input<typeof messageSchema>,
): Promise<MessageGuestsResult> {
  const { church: c, user: u } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const [ev] = await db
    .select({ id: event.id, title: event.title })
    .from(event)
    .where(and(eq(event.id, d.eventId), eq(event.churchId, c.id)))
    .limit(1);
  if (!ev) return { ok: false, error: "Event not found." };

  if (d.channel === "sms" && !smsAvailableForCountry(c.country))
    return { ok: false, error: "SMS isn't available in your country yet." };

  const where =
    d.guestIds.length > 0
      ? and(
          eq(eventGuest.eventId, d.eventId),
          eq(eventGuest.churchId, c.id),
          inArray(eventGuest.id, d.guestIds),
        )
      : and(eq(eventGuest.eventId, d.eventId), eq(eventGuest.churchId, c.id));
  const guests = await db
    .select({ name: eventGuest.name, email: eventGuest.email, phone: eventGuest.phone })
    .from(eventGuest)
    .where(where);

  if (d.channel === "sms") {
    const list = guests
      .filter((g) => g.phone)
      .map((g) => ({
        phone: g.phone as string,
        message: fill(d.body, g.name, ev.title, c.name),
      }));
    if (list.length === 0)
      return { ok: false, error: "None of those guests have a phone number." };
    const res = await sendChurchSmsBatch({
      churchId: c.id,
      recipients: list,
      userId: u.id,
      label: `Event guests · ${ev.title}`,
    });
    if (!res.ok) return res;
    return { ok: true, sent: res.sent, failed: res.failed, cost: res.cost };
  }

  const list = guests.filter((g) => g.email);
  if (list.length === 0)
    return { ok: false, error: "None of those guests have an email address." };
  const subjectBase = d.subject || `Regarding ${ev.title}`;
  const results = await Promise.allSettled(
    list.map((g) => {
      const subj = fill(subjectBase, g.name, ev.title, c.name);
      const text = fill(d.body, g.name, ev.title, c.name);
      return sendEmail({
        to: g.email as string,
        subject: subj,
        html: emailLayout(escapeHtml(subj), `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`),
        text,
        fromName: c.name,
      });
    }),
  );
  const sent = results.filter((x) => x.status === "fulfilled" && x.value).length;
  if (sent > 0) await recordUsage("email", c.id, sent);
  return { ok: true, sent, failed: list.length - sent };
}
