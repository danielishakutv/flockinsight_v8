"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { can } from "@/lib/permissions";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import {
  recordRecipients,
  tally,
  type RecipientOutcome,
} from "@/lib/comm-recipients";
import { emailOutcomesFrom } from "@/lib/comm-outcomes";
import { recomputeLogCounters } from "@/lib/delivery-reports";
import { normalizePhone } from "@/lib/sms";
import { normalizeEmail } from "@/lib/email-address";
import {
  sendEmail,
  sendEmailWithId,
  emailLayout,
  emailQueueSeconds,
  type EmailSendResult,
} from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { recordAction } from "@/lib/analytics";
import { sendPushToUsers } from "@/lib/push";
import { audit } from "@/lib/audit";
import { refuseIfDemo } from "@/lib/demo";
import { escapeHtml } from "@/lib/html-escape";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export type SendResult =
  /**
   * `unconfirmed`: SMS the gateway neither confirmed nor refused (a timeout).
   * They may have gone, were charged, and must not simply be sent again.
   */
  | { ok: true; sent: number; failed: number; cost?: number; unconfirmed?: number }
  /**
   * Accepted, but not finished. Not a success and not a failure, and the
   * person who pressed Send has to be told which of these it is:
   *
   *  - held until the SMS delivery window opens (`sendingNow` false): nothing
   *    has reached anybody and nothing has been charged;
   *  - going out now in the background (`sendingNow` true): a send too big to
   *    finish inside one request. It lands in History when it is done.
   */
  | { ok: "queued"; count: number; notice: string; sendingNow?: boolean }
  /**
   * `duplicate`: refused because this very press of Send is already going.
   * The composer keeps its request id for that one, so a third press is
   * refused too instead of going out as a fresh copy.
   */
  | { ok: false; error: string; duplicate?: boolean };

/*
 * How much is sent while the person waits, and how much after the response.
 *
 * Cloudflare gives up on a request after 100 seconds. A personalised SMS is
 * one gateway call per person and email is paced to stay inside the
 * provider's per-second limit, so a congregation-sized send runs for minutes.
 * The browser then showed an error while the server carried on sending - and
 * the natural thing to do with an error is press Send again. Small sends still
 * answer with real counts; anything bigger is accepted, said to be going, and
 * finished in the background.
 */
/*
 * 10 distinct messages at five gateway calls at a time is two rounds, so even
 * if every call runs to sms.ts's 30-second ceiling the person has an answer in
 * about a minute. At 20 it was four rounds - two minutes, past Cloudflare.
 */
const INLINE_SMS_MESSAGES = 10;
const INLINE_EMAILS = 100;
/**
 * The longest an inline email may expect to wait in the mailer's queue,
 * everything already in it counted. Well inside Cloudflare's 100 seconds,
 * leaving room for retries and the History writes.
 */
const INLINE_EMAIL_SECONDS = 45;

function fill(text: string, name: string, churchName: string) {
  return text
    .replace(/\{name\}/g, name || "there")
    .replace(/\{church\}/g, churchName);
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
      // The mailer's own rule, so what is accepted here is what it will send.
      const email = normalizeEmail(value);
      if (!email) {
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
  /**
   * One press of Send, generated by the composer and kept until it succeeds -
   * so a retry after a timeout carries the same id and is recognised.
   */
  requestId: z.string().trim().min(8).max(100).optional(),
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

  /*
   * Not from the demo.
   *
   * This action takes typed phone numbers and email addresses and sends to
   * them. On a shared login with a published password that is a spam cannon
   * aimed at our own Resend and Termii accounts — so the demo says plainly
   * that it does not send, rather than pretending to.
   */
  const demoRefusal = await refuseIfDemo(c.id, "Sending messages");
  if (demoRefusal) return demoRefusal;

  /*
   * Email is on every plan; SMS is not.
   *
   * Checked on the channel rather than on the module, because the price list
   * sells them separately: "300 emails a month" to a Starter church, "Bulk SMS
   * with your church's own sender ID" only from Pro. Gating the whole page would
   * take away email that every plan pays for.
   */
  if (d.channel === "sms") {
    const gate = await refuseWithoutFeature("sms");
    if (gate) return gate;
  }

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
      // Carried so that a send held until morning still names each person in
      // the history, instead of showing a list of bare phone numbers.
      memberId: memberIdOf(r),
      name: r.name,
    }));
    if (list.length === 0)
      return {
        ok: false,
        error:
          d.audience === "contacts"
            ? "Add at least one phone number."
            : "None of those members have a phone number.",
      };

    // One gateway call per distinct message, so this is the measure of how
    // long the send takes - not the head count.
    const distinct = new Set(list.map((r) => r.message)).size;
    const res = await sendChurchSmsBatch({
      churchId: c.id,
      recipients: list,
      userId: u.id,
      label: `${d.audienceLabel} · SMS`,
      origin: "communication",
      timing: distinct > INLINE_SMS_MESSAGES ? "background" : "queue",
      requestId: d.requestId ?? null,
    });
    if (res.ok === false) return res;

    /*
     * In the queue: either held for 8am, or going out now in the background.
     * Either way there is no delivery to record yet and no communication_log
     * row to write — the queue worker writes one when the message actually
     * goes, with the real counts and the real cost. Logging it now would put a
     * send in the history that has not happened.
     */
    if (res.ok === "queued") {
      if (res.sendingNow) {
        const rowId = res.id;
        // After the response, so the person is told it is going before it goes.
        // If this process dies first, the row is still due and the cron sends it.
        after(async () => {
          try {
            const { sendQueuedSmsNow } = await import("@/lib/sms-queue");
            await sendQueuedSmsNow(rowId);
          } catch (e) {
            console.error(`[communication] background SMS ${rowId} for church ${c.id} failed to start:`, e);
          }
        });
      }
      await audit({
        churchId: c.id,
        action: "communication.sms.queue",
        summary: res.sendingNow
          ? `Started sending an SMS to ${res.count} ${d.audienceLabel.toLowerCase()}`
          : `Queued an SMS to ${res.count} ${d.audienceLabel.toLowerCase()} for the next delivery window`,
        targetType: "communication",
        targetId: null,
        targetLabel: d.audienceLabel,
        meta: {
          channel: "sms",
          audience: d.audience,
          body: d.body,
          recipients: res.count,
          sendAfter: res.sendAfter.toISOString(),
          background: res.sendingNow,
        },
        severity: "notice",
      });
      revalidatePath("/communication");
      return {
        ok: "queued",
        count: res.count,
        notice: res.notice,
        sendingNow: res.sendingNow,
      };
    }

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
    // The pages that actually went, each personalised copy counted on its own.
    const units = res.pages;
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
    await audit({
      churchId: c.id,
      action: "communication.sms.send",
      summary: `Sent an SMS to ${counts.sent} of ${counts.recipients} ${d.audienceLabel.toLowerCase()}`,
      targetType: "communication",
      targetId: log.id,
      targetLabel: d.audienceLabel,
      // The message itself, because "who sent that text?" is the question this
      // log exists to answer, and the wording is half the answer.
      meta: {
        channel: "sms",
        audience: d.audience,
        body: d.body,
        recipients: counts.recipients,
        sent: counts.sent,
        failed: counts.failed,
        skipped: counts.skipped,
        units,
        cost: res.cost,
      },
      severity: "notice",
    });

    revalidatePath("/communication");
    revalidatePath("/communication/history");
    return {
      ok: true,
      sent: res.sent,
      failed: res.failed,
      unconfirmed: res.unconfirmed,
      cost: res.cost,
    };
  }

  // Email. An address the mailer would refuse is skipped here, with the
  // reason, rather than spending a provider request to be told the same.
  const outcomes: RecipientOutcome[] = [];
  const list: { r: Recipient; email: string }[] = [];
  for (const r of recipients) {
    if (!r.email) {
      outcomes.push({
        memberId: memberIdOf(r),
        name: r.name,
        destination: null,
        status: "skipped",
        error: "No email address on file",
      });
      continue;
    }
    const email = normalizeEmail(r.email);
    if (!email) {
      outcomes.push({
        memberId: memberIdOf(r),
        name: r.name,
        destination: r.email,
        status: "skipped",
        error: "Not a valid email address - correct it on the member's record",
      });
      continue;
    }
    list.push({ r, email });
  }
  if (list.length === 0)
    return {
      ok: false,
      error:
        d.audience === "contacts"
          ? "Add at least one email address."
          : outcomes.some((o) => o.destination)
            ? "None of those members have a usable email address."
            : "None of those members have an email address.",
    };

  const job: EmailJob = {
    churchId: c.id,
    churchName: c.name,
    plan: c.plan,
    userId: u.id,
    audience: d.audience,
    audienceLabel: d.audienceLabel,
    subject: d.subject || null,
    body: d.body,
    list,
    skipped: outcomes,
  };

  /*
   * The History row first, before a single message goes.
   *
   * It carries the request id, and the column is unique: a second press of the
   * same Send - a double tap, or a retry after the answer was lost - is refused
   * by the database whichever worker it lands on, instead of emailing everyone
   * twice. And because it exists from the start, a send a restart kills
   * half-way still leaves a row saying how far it got (see comm-log-state.ts).
   */
  const [log] = await db
    .insert(communicationLog)
    .values({
      churchId: c.id,
      channel: "email",
      audience: d.audienceLabel,
      subject: job.subject,
      body: d.body,
      recipients: list.length + outcomes.length,
      sent: 0,
      failed: 0,
      skipped: outcomes.length,
      status: "sending",
      requestId: d.requestId ?? null,
      createdBy: u.id,
    })
    .onConflictDoNothing({ target: communicationLog.requestId })
    .returning({ id: communicationLog.id });
  if (!log)
    return {
      ok: false,
      duplicate: true,
      error: "This email is already being sent. Check History before sending it again.",
    };
  await recordRecipients(log.id, c.id, outcomes);

  /*
   * In the background when the person would otherwise wait too long - judged
   * on everything already in the mailer's queue, not just this list. The bulk
   * lane is shared and first-come, so a 60-person email sent while a devotional
   * to 1,000 is going out waits behind all of it, past Cloudflare's 100
   * seconds, and the browser says it could not confirm.
   */
  if (list.length > INLINE_EMAILS || emailQueueSeconds(list.length) > INLINE_EMAIL_SECONDS) {
    after(async () => {
      try {
        await deliverEmails(job, log.id);
      } catch (e) {
        await markEmailInterrupted(log.id, c.id, e);
      }
    });
    revalidatePath("/communication/history");
    return {
      ok: "queued",
      count: list.length,
      sendingNow: true,
      notice: `Sending to ${list.length} people now. It is in History already, and fills in with who got it as it goes out.`,
    };
  }

  let counts: { sent: number; failed: number };
  try {
    counts = await deliverEmails(job, log.id);
  } catch (e) {
    await markEmailInterrupted(log.id, c.id, e);
    revalidatePath("/communication/history");
    return {
      ok: false,
      error:
        "Sending stopped part-way on an internal error. History shows who it reached; check it before sending again, so nobody gets it twice.",
    };
  }
  revalidatePath("/communication");
  revalidatePath("/communication/history");
  return { ok: true, sent: counts.sent, failed: counts.failed };
}

/**
 * Say so when a send stopped on an error, rather than leaving its History row
 * at "sending". Never throws: it runs where the original error is already
 * being handled, and losing that to a second one would hide both.
 */
async function markEmailInterrupted(logId: string, churchId: string, cause: unknown) {
  console.error(`[communication] email ${logId} for church ${churchId} stopped part-way:`, cause);
  try {
    await db
      .update(communicationLog)
      .set({ status: "interrupted" })
      .where(and(eq(communicationLog.id, logId), eq(communicationLog.status, "sending")));
  } catch (e) {
    // History still calls it interrupted once it has been quiet for
    // LOG_STALLED_AFTER_MINUTES; this only says so sooner.
    console.error(`[communication] could not mark email ${logId} interrupted:`, e);
  }
}

type EmailJob = {
  churchId: string;
  churchName: string;
  plan: string;
  userId: string;
  audience: string;
  audienceLabel: string;
  subject: string | null;
  body: string;
  list: { r: Recipient; email: string }[];
  /** Recipients already settled before sending (no address, a bad one). */
  skipped: RecipientOutcome[];
};

/** How many results are written to History at a time while a send runs. */
const EMAIL_PROGRESS_EVERY = 50;

/**
 * Send a church email to its list, writing down what happened as it goes.
 *
 * Shared by the inline path and the background one, so both record the same
 * way, against the History row the caller has already opened. The mailer
 * paces and retries (lib/email-pacing.ts), so every message is handed over at
 * once and waits its turn in the bulk lane - behind any password reset that
 * arrives meanwhile - while the results are collected in order, 50 at a time:
 * their recipient rows written and the row's counts moved on, so a send cut
 * short leaves an accurate record of how far it got.
 */
async function deliverEmails(job: EmailJob, logId: string) {
  const subjectBase = job.subject || `A message from ${job.churchName}`;
  const pending: Promise<PromiseSettledResult<EmailSendResult>>[] = job.list.map(
    ({ r, email }) => {
      const send = async () => {
        const subj = fill(subjectBase, r.name, job.churchName);
        const text = fill(job.body, r.name, job.churchName);
        const html = emailLayout(
          escapeHtml(subj),
          `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`,
        );
        // WithId so a delivery report can be tied back to this person.
        return sendEmailWithId({
          to: email,
          subject: subj,
          html,
          text,
          fromName: job.churchName,
          bulk: true,
        });
      };
      // Settled here, at once, so no rejection is ever left unobserved while
      // the loop below is still awaiting an earlier slice.
      return send().then(
        (value): PromiseSettledResult<EmailSendResult> => ({ status: "fulfilled", value }),
        (reason: unknown): PromiseSettledResult<EmailSendResult> => ({
          status: "rejected",
          reason,
        }),
      );
    },
  );

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < job.list.length; i += EMAIL_PROGRESS_EVERY) {
    const slice = job.list.slice(i, i + EMAIL_PROGRESS_EVERY);
    const results = await Promise.all(pending.slice(i, i + EMAIL_PROGRESS_EVERY));
    // results[i] lines up with slice[i], so each address keeps its own verdict -
    // and `.ok`, never the result object, decides it. See comm-outcomes.ts.
    const outcomes = emailOutcomesFrom(
      slice.map(({ r, email }) => ({ memberId: memberIdOf(r), name: r.name, email })),
      results,
    );
    await recordRecipients(logId, job.churchId, outcomes);
    const step = tally(outcomes);
    sent += step.sent;
    failed += step.failed;
    // Counted from the recipient rows, exactly as a delivery report recounts
    // them - so the two can interleave without either one adding twice.
    await recomputeLogCounters(logId);
  }

  await db
    .update(communicationLog)
    .set({ status: "done" })
    .where(eq(communicationLog.id, logId));

  const recipients = job.list.length + job.skipped.length;
  const skipped = job.skipped.length;
  if (sent > 0) await recordUsage("email", job.churchId, sent);
  try {
    await recordAction({
      churchId: job.churchId,
      userId: job.userId,
      name: "email.sent",
      plan: job.plan,
      props: { sent },
    });
  } catch (e) {
    // Analytics only; the send and its history are already recorded.
    console.error("[communication] could not record the email.sent action:", e);
  }
  await audit({
    churchId: job.churchId,
    action: "communication.email.send",
    summary: `Emailed ${sent} of ${recipients} ${job.audienceLabel.toLowerCase()}${job.subject ? ` — "${job.subject}"` : ""}`,
    targetType: "communication",
    targetId: logId,
    targetLabel: job.subject || job.audienceLabel,
    meta: {
      channel: "email",
      audience: job.audience,
      subject: job.subject,
      body: job.body,
      recipients,
      sent,
      failed,
      skipped,
    },
    severity: "notice",
  });
  return { sent, failed };
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
  await audit({
    churchId: c.id,
    action: "communication.staff.send",
    summary: `Sent the staff notice "${d.title}" to ${userIds.length} team member${userIds.length === 1 ? "" : "s"}`,
    targetType: "communication",
    targetId: log.id,
    targetLabel: d.title,
    meta: {
      channel: "notification",
      title: d.title,
      body: d.body,
      staff: userIds.length,
      pushSent,
      emailSent,
    },
    severity: "notice",
  });

  revalidatePath("/communication");
  revalidatePath("/communication/history");
  revalidatePath("/notifications");
  return { ok: true, staff: userIds.length, pushSent, emailSent };
}

/**
 * Cancel an SMS that is waiting for the delivery window.
 *
 * Scoped to the caller's church inside `cancelQueuedSms`, so an id typed into
 * a form cannot reach another church's queue — and only a row still waiting
 * can be cancelled, because cancelling something already sent is not a thing
 * that can happen and saying it worked would be a lie.
 */
export async function cancelQueuedSmsAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { church: c, user: u } = await requireChurch();
  if (!(await can("communication.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  const { cancelQueuedSms } = await import("@/lib/sms-queue");
  const done = await cancelQueuedSms(c.id, String(id || ""));
  if (!done)
    return {
      ok: false,
      error: "That message has already gone out, or isn't waiting any more.",
    };

  await audit({
    churchId: c.id,
    action: "communication.sms.cancel",
    summary: "Cancelled an SMS that was waiting for the delivery window",
    targetType: "communication",
    targetId: id,
    severity: "notice",
  });
  void u;

  revalidatePath("/communication");
  return { ok: true };
}
