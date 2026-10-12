import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { church, devotional, member, subscriber } from "@/db/schema";
import { sendEmail, isEmailConfigured } from "@/lib/mailer";
import { normalizeEmail } from "@/lib/email-address";
import { isOptedOut, optOutKey } from "@/lib/devotional-recipients";
import { recordUsage } from "@/lib/usage";
import { siteUrl } from "@/lib/site";
import { escapeHtml } from "@/lib/html-escape";

const SECRET =
  process.env.BETTER_AUTH_SECRET || process.env.CRON_SECRET || "flockinsight-dev";

/* ----- Unsubscribe tokens (signed, no DB lookup needed) ----- */

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

export function unsubscribeToken(churchId: string, email: string): string {
  return createHmac("sha256", SECRET)
    .update(`${churchId}:${email.toLowerCase()}`)
    .digest("base64url");
}

export function verifyUnsubscribe(
  churchId: string,
  email: string,
  token: string,
): boolean {
  const expected = unsubscribeToken(churchId, email);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * The link in the email.
 *
 * It goes to /api/newsletter/unsubscribe, which records the opt-out and then
 * shows the /n/unsubscribe page. Not straight to that page, because the page
 * can only mark an existing subscriber row - and somebody who receives these
 * as a MEMBER has no subscriber row, so their click changed nothing while the
 * page told them they were unsubscribed. The route writes the row.
 */
export function unsubscribeUrl(churchId: string, email: string): string {
  return `${siteUrl()}/api/newsletter/unsubscribe?${unsubscribeQuery(churchId, email)}`;
}

/** The signed query both the link and the page read: c, e and t. */
export function unsubscribeQuery(churchId: string, email: string): string {
  const t = unsubscribeToken(churchId, email);
  return `c=${encodeURIComponent(churchId)}&e=${b64url(email)}&t=${t}`;
}

/*
 * Re-subscribe confirmation.
 *
 * Somebody who unsubscribed is only put back on a church's list by clicking a
 * link sent to their own address - never by whoever typed it into the public
 * form. A separate purpose in the signature, so an unsubscribe link can never
 * be replayed as a re-subscribe, and an issue time, so a link found in an old
 * mailbox a year later does not quietly re-enrol anyone.
 */
const RESUB_TTL_MS = 7 * 24 * 60 * 60_000;

function resubscribeToken(churchId: string, email: string, issuedAt: number): string {
  return createHmac("sha256", SECRET)
    .update(`resubscribe:${churchId}:${email.toLowerCase()}:${issuedAt}`)
    .digest("base64url");
}

export function resubscribeUrl(churchId: string, email: string): string {
  const at = Date.now();
  const t = resubscribeToken(churchId, email, at);
  return `${siteUrl()}/api/newsletter/resubscribe?c=${encodeURIComponent(churchId)}&e=${b64url(email)}&a=${at}&t=${t}`;
}

export function verifyResubscribe(
  churchId: string,
  email: string,
  issuedAt: number,
  token: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(issuedAt) || issuedAt > now || now - issuedAt > RESUB_TTL_MS)
    return false;
  const expected = resubscribeToken(churchId, email, issuedAt);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decodeUnsubEmail(encoded: string): string {
  try {
    return fromB64url(encoded);
  } catch {
    return "";
  }
}

/* ----- Recipients ----- */

export type Recipient = { email: string; name: string; isSubscriber: boolean };

/**
 * De-duplicated recipients for a devotional, by audience.
 *
 * AN OPT-OUT IS AN OPT-OUT, WHICHEVER LIST THEY ARE ON. Members used to be
 * added without looking at the subscriber table at all, so a member who
 * clicked Unsubscribe was dropped from the subscriber half and added straight
 * back through the member half - now with no unsubscribe link, because they
 * no longer counted as a subscriber. Everybody who has unsubscribed from this
 * church is left out, members included.
 */
export async function resolveRecipients(
  churchId: string,
  audience: string,
): Promise<Recipient[]> {
  const wantMembers = audience === "members" || audience === "both";
  const wantSubs = audience === "subscribers" || audience === "both";
  const map = new Map<string, Recipient>();

  const optedOut = new Set(
    (
      await db
        .select({ email: subscriber.email })
        .from(subscriber)
        .where(and(eq(subscriber.churchId, churchId), eq(subscriber.status, "unsubscribed")))
    ).map((r) => optOutKey(r.email)),
  );

  if (wantMembers) {
    const rows = await db
      .select({
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(and(eq(member.churchId, churchId), isNotNull(member.email), ne(member.email, "")));
    for (const r of rows) {
      // An address the mailer would refuse is left out here rather than
      // spending a provider request to be told so.
      const email = normalizeEmail(r.email);
      if (!email || isOptedOut(optedOut, email)) continue;
      if (!map.has(email))
        map.set(email, {
          email,
          name: [r.firstName, r.lastName].filter(Boolean).join(" "),
          isSubscriber: false,
        });
    }
  }

  if (wantSubs) {
    const rows = await db
      .select({ email: subscriber.email, name: subscriber.name })
      .from(subscriber)
      .where(and(eq(subscriber.churchId, churchId), eq(subscriber.status, "active")));
    for (const r of rows) {
      const email = normalizeEmail(r.email);
      if (!email || isOptedOut(optedOut, email)) continue;
      const existing = map.get(email);
      if (existing) existing.isSubscriber = true;
      else map.set(email, { email, name: r.name ?? "", isSubscriber: true });
    }
  }

  return [...map.values()];
}

/* ----- Email rendering ----- */

function renderEmail(opts: {
  churchName: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  unsubUrl?: string | null;
  type: "devotional" | "newsletter";
}): { html: string; text: string } {
  const safeBody = opts.body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#2b2740">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");

  const img = opts.imageUrl
    ? `<img src="${opts.imageUrl}" alt="" style="width:100%;border-radius:12px;margin-bottom:18px"/>`
    : "";

  // Neutral wording: a member reached through the member list never
  // "subscribed", and telling them they did is how a message gets reported.
  const unsub = opts.unsubUrl
    ? `<p style="font-size:12px;color:#9b97ad;margin-top:28px">You're receiving this from ${escapeHtml(opts.churchName)}. <a href="${opts.unsubUrl}" style="color:#9b97ad;text-decoration:underline">Unsubscribe</a> from these emails.</p>`
    : "";

  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1626">
    <div style="font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#8a86a0;margin-bottom:4px">${escapeHtml(opts.churchName)}</div>
    <h1 style="font-size:22px;margin:0 0 16px;line-height:1.3">${escapeHtml(opts.title)}</h1>
    ${img}
    ${safeBody}
    ${unsub}
    <p style="font-size:11px;color:#c3c0cf;margin-top:18px">Sent with FlockInsight</p>
  </div>`;

  const text = `${opts.churchName}\n\n${opts.title}\n\n${opts.body}${opts.unsubUrl ? `\n\nUnsubscribe: ${opts.unsubUrl}` : ""}`;
  return { html, text };
}

/* ----- Sending ----- */

export type SendResult =
  | { ok: true; sent: number; recipients: number }
  | { ok: false; error: string };

/**
 * Send one devotional/newsletter to its audience. Marks it sent and records
 * counts. Safe to call from a send-now action or the scheduler cron.
 */
export async function sendDevotional(devotionalId: string): Promise<SendResult> {
  if (!isEmailConfigured())
    return { ok: false, error: "Email isn't configured on the platform yet." };

  const [d] = await db
    .select()
    .from(devotional)
    .where(eq(devotional.id, devotionalId))
    .limit(1);
  if (!d) return { ok: false, error: "Not found." };
  if (d.status === "sent")
    return { ok: false, error: "This has already been sent." };

  // Atomically claim it (status -> sent) so a concurrent send/cron can't
  // double-send. If nothing comes back, someone else already claimed it.
  const [claimed] = await db
    .update(devotional)
    .set({ status: "sent", sentAt: new Date() })
    .where(and(eq(devotional.id, d.id), ne(devotional.status, "sent")))
    .returning({ id: devotional.id });
  if (!claimed) return { ok: false, error: "This has already been sent." };

  const [c] = await db
    .select({ name: church.name, publicEmail: church.publicEmail })
    .from(church)
    .where(eq(church.id, d.churchId))
    .limit(1);
  const churchName = c?.name ?? "Your church";
  const replyTo = c?.publicEmail || undefined;

  const recipients = await resolveRecipients(d.churchId, d.audience);
  if (recipients.length === 0) {
    await db
      .update(devotional)
      .set({ recipients: 0, sentCount: 0 })
      .where(eq(devotional.id, d.id));
    return { ok: true, sent: 0, recipients: 0 };
  }

  /*
   * Every recipient gets an unsubscribe link and the List-Unsubscribe header,
   * not only those on the subscriber list. Members were sent these with no way
   * out at all, which bulk-mail rules (Gmail, Yahoo) do not allow and which
   * turns "stop" into "report spam" - against the sending domain every church
   * shares. The mailer paces and retries; `bulk` keeps a password reset from
   * queueing behind a newsletter.
   */
  const results = await Promise.allSettled(
    recipients.map((r) => {
      const unsubUrl = unsubscribeUrl(d.churchId, r.email);
      const { html, text } = renderEmail({
        churchName,
        title: d.title,
        body: d.body,
        imageUrl: d.imageUrl,
        unsubUrl,
        type: d.type,
      });
      return sendEmail({
        to: r.email,
        subject: d.title,
        html,
        text,
        fromName: churchName,
        replyTo,
        bulk: true,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    }),
  );
  let sent = 0;
  results.forEach((x, i) => {
    if (x.status === "fulfilled" && x.value === true) sent++;
    else if (x.status === "rejected")
      console.error(
        `[devotionals] send to ${recipients[i].email} for church ${d.churchId} threw:`,
        x.reason,
      );
  });

  await db
    .update(devotional)
    .set({ recipients: recipients.length, sentCount: sent })
    .where(eq(devotional.id, d.id));

  if (sent > 0) await recordUsage("email", d.churchId, sent);

  return { ok: true, sent, recipients: recipients.length };
}
