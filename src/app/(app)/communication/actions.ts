"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  communicationLog,
  groupMembership,
  member,
  notification,
  notificationTarget,
  staff,
  user,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { sendPushToUsers } from "@/lib/push";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export type SendResult =
  | { ok: true; sent: number; failed: number; cost?: number }
  | { ok: false; error: string };

function fill(text: string, name: string, churchName: string) {
  return text
    .replace(/\{name\}/g, name || "there")
    .replace(/\{church\}/g, churchName);
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Recipient = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

async function resolveRecipients(
  churchId: string,
  audience: "all" | "group" | "selected" | "single",
  groupId: string | null,
  memberIds: string[],
): Promise<Recipient[]> {
  const cols = {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    phone: member.phone,
    email: member.email,
  };
  let rows: {
    id: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
    email: string | null;
  }[] = [];

  if (audience === "all") {
    rows = await db.select(cols).from(member).where(eq(member.churchId, churchId));
  } else if (audience === "group" && groupId) {
    rows = await db
      .select(cols)
      .from(groupMembership)
      .innerJoin(member, eq(member.id, groupMembership.memberId))
      .where(
        and(eq(groupMembership.groupId, groupId), eq(member.churchId, churchId)),
      );
  } else if ((audience === "selected" || audience === "single") && memberIds.length) {
    rows = await db
      .select(cols)
      .from(member)
      .where(and(eq(member.churchId, churchId), inArray(member.id, memberIds)));
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.firstName,
    phone: r.phone,
    email: r.email,
  }));
}

const sendSchema = z.object({
  channel: z.enum(["sms", "email"]),
  audience: z.enum(["all", "group", "selected", "single"]),
  groupId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().uuid().nullable(),
  ),
  memberIds: z.array(z.string().uuid()).default([]),
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1, "Message is empty").max(2000),
  audienceLabel: z.string().trim().max(80).default("Members"),
});

export async function sendCommunication(
  input: z.input<typeof sendSchema>,
): Promise<SendResult> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const { church: c, user: u } = await requireChurch();
  if (!(await can("communication.manage")))
    return { ok: false, error: "You don't have permission to send messages." };

  const recipients = await resolveRecipients(
    c.id,
    d.audience,
    d.groupId,
    d.memberIds,
  );
  if (recipients.length === 0)
    return { ok: false, error: "No recipients matched your selection." };

  if (d.channel === "sms") {
    const list = recipients
      .filter((r) => r.phone)
      .map((r) => ({ phone: r.phone as string, message: fill(d.body, r.name, c.name) }));
    if (list.length === 0)
      return { ok: false, error: "None of those members have a phone number." };

    const res = await sendChurchSmsBatch({
      churchId: c.id,
      recipients: list,
      userId: u.id,
      label: `${d.audienceLabel} · SMS`,
    });
    if (!res.ok) return res;

    await db.insert(communicationLog).values({
      churchId: c.id,
      channel: "sms",
      audience: d.audienceLabel,
      body: d.body,
      recipients: list.length,
      sent: res.sent,
      failed: res.failed,
      cost: res.cost,
      createdBy: u.id,
    });
    revalidatePath("/communication");
    return { ok: true, sent: res.sent, failed: res.failed, cost: res.cost };
  }

  // Email
  const list = recipients.filter((r) => r.email);
  if (list.length === 0)
    return { ok: false, error: "None of those members have an email address." };

  const subjectBase = d.subject || `A message from ${c.name}`;
  const results = await Promise.allSettled(
    list.map((r) => {
      const subj = fill(subjectBase, r.name, c.name);
      const text = fill(d.body, r.name, c.name);
      const html = emailLayout(
        escapeHtml(subj),
        `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`,
      );
      return sendEmail({ to: r.email as string, subject: subj, html, text });
    }),
  );
  const sent = results.filter((x) => x.status === "fulfilled" && x.value).length;

  await db.insert(communicationLog).values({
    churchId: c.id,
    channel: "email",
    audience: d.audienceLabel,
    subject: d.subject || null,
    body: d.body,
    recipients: list.length,
    sent,
    failed: list.length - sent,
    createdBy: u.id,
  });
  revalidatePath("/communication");
  return { ok: true, sent, failed: list.length - sent };
}

const staffSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  body: z.string().trim().min(1, "Message is empty").max(2000),
  alsoEmail: z.boolean().default(true),
});

export type StaffResult =
  | { ok: true; staff: number; pushSent: number; emailSent: number }
  | { ok: false; error: string };

export async function notifyStaff(
  input: z.input<typeof staffSchema>,
): Promise<StaffResult> {
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const { church: c, user: u } = await requireChurch();
  if (!(await can("communication.manage")))
    return { ok: false, error: "You don't have permission to send messages." };

  // In-app notification scoped to this church only.
  const [row] = await db
    .insert(notification)
    .values({
      title: d.title,
      body: d.body,
      category: "general",
      audience: "churches",
      createdBy: u.id,
    })
    .returning({ id: notification.id });
  await db
    .insert(notificationTarget)
    .values({ notificationId: row.id, churchId: c.id });

  const staffRows = await db
    .select({ userId: staff.userId, email: user.email })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .where(eq(staff.organizationId, c.id));
  const userIds = staffRows.map((s) => s.userId);

  const pushSent = await sendPushToUsers(userIds, {
    title: d.title,
    body: d.body,
    url: "/notifications",
    tag: row.id,
  });

  let emailSent = 0;
  if (d.alsoEmail) {
    const results = await Promise.allSettled(
      staffRows.map((s) =>
        sendEmail({
          to: s.email,
          subject: d.title,
          html: emailLayout(
            escapeHtml(d.title),
            `<p>${escapeHtml(d.body).replace(/\n/g, "<br/>")}</p>`,
            { label: "Open FlockInsight", url: `${BASE_URL}/notifications` },
          ),
          text: d.body,
        }),
      ),
    );
    emailSent = results.filter((x) => x.status === "fulfilled" && x.value).length;
  }

  await db.insert(communicationLog).values({
    churchId: c.id,
    channel: "notification",
    audience: "All staff",
    subject: d.title,
    body: d.body,
    recipients: userIds.length,
    sent: userIds.length,
    failed: 0,
    createdBy: u.id,
  });
  revalidatePath("/communication");
  revalidatePath("/notifications");
  return { ok: true, staff: userIds.length, pushSent, emailSent };
}
