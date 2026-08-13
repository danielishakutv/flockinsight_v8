"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
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
import {
  recordRecipients,
  tally,
  type RecipientOutcome,
} from "@/lib/comm-recipients";
import { normalizePhone, smsPages } from "@/lib/sms";
import { sendEmail, sendEmailWithId, emailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { recordAction } from "@/lib/analytics";
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

/**
 * Hand-typed contacts get a synthetic `contact:<value>` id — they aren't
 * members, so they must not be written to the member foreign key.
 */
function memberIdOf(r: Recipient): string | null {
  return r.id.startsWith("contact:") ? null : r.id;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn hand-typed phone numbers / email addresses into recipients. These
 * people aren't members yet, so there's no name to personalise with.
 */
function resolveTypedContacts(
  channel: "sms" | "email",
  raw: string[],
): { ok: true; recipients: Recipient[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  const invalid: string[] = [];

  for (const entry of raw) {
    const value = entry.trim();
    if (!value) continue;
    if (channel === "sms") {
      const phone = normalizePhone(value);
      if (!phone) {
        invalid.push(value);
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      recipients.push({ id: `contact:${phone}`, name: "", phone, email: null });
    } else {
      const email = value.toLowerCase();
      if (!EMAIL_RE.test(email)) {
        invalid.push(value);
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push({ id: `contact:${email}`, name: "", phone: null, email });
    }
  }

  if (invalid.length)
    return {
      ok: false,
      error: `Check ${invalid.length === 1 ? "this" : "these"}: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`,
    };
  if (recipients.length === 0)
    return {
      ok: false,
      error:
        channel === "sms"
          ? "Add at least one phone number."
          : "Add at least one email address.",
    };
  return { ok: true, recipients };
}

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
  audience: z.enum(["all", "group", "selected", "single", "contacts"]),
  groupId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().uuid().nullable(),
  ),
  memberIds: z.array(z.string().uuid()).default([]),
  /**
   * Phone numbers / email addresses typed in by hand — people who aren't in
   * the member list yet. Only used when audience is "contacts".
   */
  contacts: z.array(z.string().trim().min(1).max(160)).max(200).default([]),
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

  let recipients: Recipient[];
  if (d.audience === "contacts") {
    const typed = resolveTypedContacts(d.channel, d.contacts);
    if (!typed.ok) return typed;
    recipients = typed.recipients;
  } else {
    recipients = await resolveRecipients(
      c.id,
      d.audience,
      d.groupId,
      d.memberIds,
    );
  }
  if (recipients.length === 0)
    return { ok: false, error: "No recipients matched your selection." };

  if (d.channel === "sms") {
    // People with no number on file are part of the story — they're recorded
    // as skipped rather than quietly vanishing from the count.
    const reachable = recipients.filter((r) => r.phone);
    const outcomes: RecipientOutcome[] = recipients
      .filter((r) => !r.phone)
      .map((r) => ({
        memberId: memberIdOf(r),
        name: r.name,
        destination: null,
        status: "skipped" as const,
        error: "No phone number on file",
      }));

    const list = reachable.map((r) => ({
      phone: r.phone as string,
      message: fill(d.body, r.name, c.name),
    }));
    if (list.length === 0)
      return {
        ok: false,
        error:
          d.audience === "contacts"
            ? "Add at least one phone number."
            : "None of those members have a phone number.",
      };

    const res = await sendChurchSmsBatch({
      churchId: c.id,
      recipients: list,
      userId: u.id,
      label: `${d.audienceLabel} · SMS`,
    });
    if (!res.ok) return res;

    // Match each gateway outcome back to the person it belongs to. Outcomes
    // come back keyed by the number exactly as we supplied it.
    const byPhone = new Map<string, Recipient[]>();
    for (const r of reachable) {
      const arr = byPhone.get(r.phone as string) ?? [];
      arr.push(r);
      byPhone.set(r.phone as string, arr);
    }
    for (const o of res.outcomes) {
      const person = byPhone.get(o.phone)?.shift();
      outcomes.push({
        memberId: person ? memberIdOf(person) : null,
        name: person?.name ?? null,
        destination: o.phone,
        status: o.status,
        error: o.error ?? null,
        providerMessageId: o.providerMessageId ?? null,
      });
    }

    const counts = tally(outcomes);
    const units = smsPages(d.body) * res.sent;
    const [log] = await db
      .insert(communicationLog)
      .values({
        churchId: c.id,
        channel: "sms",
        audience: d.audienceLabel,
        body: d.body,
        recipients: counts.recipients,
        sent: counts.sent,
        failed: counts.failed,
        skipped: counts.skipped,
        units,
        cost: res.cost,
        createdBy: u.id,
      })
      .returning({ id: communicationLog.id });
    await recordRecipients(log.id, c.id, outcomes);
    try {
      await recordAction({
        churchId: c.id,
        userId: u.id,
        name: "sms.sent",
        plan: c.plan,
        props: { sent: res.sent, units },
      });
    } catch {
      /* best-effort */
    }
    revalidatePath("/communication");
    revalidatePath("/communication/history");
    return { ok: true, sent: res.sent, failed: res.failed, cost: res.cost };
  }

  // Email
  const list = recipients.filter((r) => r.email);
  if (list.length === 0)
    return {
      ok: false,
      error:
        d.audience === "contacts"
          ? "Add at least one email address."
          : "None of those members have an email address.",
    };

  const outcomes: RecipientOutcome[] = recipients
    .filter((r) => !r.email)
    .map((r) => ({
      memberId: memberIdOf(r),
      name: r.name,
      destination: null,
      status: "skipped" as const,
      error: "No email address on file",
    }));

  const subjectBase = d.subject || `A message from ${c.name}`;
  const results = await Promise.allSettled(
    list.map((r) => {
      const subj = fill(subjectBase, r.name, c.name);
      const text = fill(d.body, r.name, c.name);
      const html = emailLayout(
        escapeHtml(subj),
        `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`,
      );
      // WithId so a Resend delivery report can be tied back to this person.
      return sendEmailWithId({ to: r.email as string, subject: subj, html, text, fromName: c.name });
    }),
  );
  // results[i] lines up with list[i], so each address keeps its own verdict.
  results.forEach((x, i) => {
    const r = list[i];
    const ok = x.status === "fulfilled" && x.value;
    outcomes.push({
      memberId: memberIdOf(r),
      name: r.name,
      destination: r.email,
      status: ok ? "sent" : "failed",
      error: ok
        ? null
        : x.status === "rejected"
          ? String((x.reason as Error)?.message ?? x.reason).slice(0, 300)
          : "The mail server did not accept this address",
    });
  });

  const counts = tally(outcomes);
  if (counts.sent > 0) await recordUsage("email", c.id, counts.sent);

  const [log] = await db
    .insert(communicationLog)
    .values({
      churchId: c.id,
      channel: "email",
      audience: d.audienceLabel,
      subject: d.subject || null,
      body: d.body,
      recipients: counts.recipients,
      sent: counts.sent,
      failed: counts.failed,
      skipped: counts.skipped,
      createdBy: u.id,
    })
    .returning({ id: communicationLog.id });
  await recordRecipients(log.id, c.id, outcomes);
  try {
    await recordAction({
      churchId: c.id,
      userId: u.id,
      name: "email.sent",
      plan: c.plan,
      props: { sent: counts.sent },
    });
  } catch {
    /* best-effort */
  }
  revalidatePath("/communication");
  revalidatePath("/communication/history");
  return { ok: true, sent: counts.sent, failed: counts.failed };
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
          fromName: c.name,
        }),
      ),
    );
    emailSent = results.filter((x) => x.status === "fulfilled" && x.value).length;
  }

  const [log] = await db
    .insert(communicationLog)
    .values({
      churchId: c.id,
      channel: "notification",
      audience: "All staff",
      subject: d.title,
      body: d.body,
      recipients: userIds.length,
      sent: userIds.length,
      failed: 0,
      createdBy: u.id,
    })
    .returning({ id: communicationLog.id });
  // An in-app notice always lands for every staff member — there's no
  // per-person failure mode — but recording them keeps the detail view
  // consistent across all three channels.
  await recordRecipients(
    log.id,
    c.id,
    staffRows.map((s) => ({
      memberId: null,
      name: s.email,
      destination: s.email,
      status: "sent" as const,
    })),
  );
  revalidatePath("/communication");
  revalidatePath("/communication/history");
  revalidatePath("/notifications");
  return { ok: true, staff: userIds.length, pushSent, emailSent };
}
