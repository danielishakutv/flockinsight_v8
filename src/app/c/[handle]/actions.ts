"use server";

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, subscriber } from "@/db/schema";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { resubscribeUrl, unsubscribeUrl } from "@/lib/devotionals";
import { escapeHtml } from "@/lib/html-escape";
import { normalizeEmail } from "@/lib/email-address";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export type SubscribeResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  handle: z.string().trim().min(1),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(160),
  /** Honeypot: hidden from people, filled in by scripts. */
  website: z.string().max(500).optional(),
});

const HOUR = 60 * 60_000;

/**
 * Public newsletter sign-up from a church's public page.
 *
 * Unauthenticated and on our sending domain, so it is built not to be a relay.
 * It used to send "You're subscribed to <Church>" to any address, as often as
 * asked, with a free-text name - "Claim your gift at evil.example" - printed in
 * the body: a spam and phishing cannon with our DKIM on it, and every
 * complaint against it counted against the domain every church sends from.
 *
 *  - a honeypot field and per-IP / per-church ceilings;
 *  - at most one email a day to any one address, whichever church asks;
 *  - nothing the caller typed appears in the email;
 *  - somebody who unsubscribed is NOT put back on the list by whoever knows
 *    their address. They get one email with a signed link, and only clicking
 *    it brings them back.
 */
export async function subscribeNewsletter(input: {
  handle: string;
  name?: string;
  email: string;
  website?: string;
}): Promise<SubscribeResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid." };
  const d = parsed.data;

  // A filled honeypot is a script. It is told it worked and nothing happens,
  // so it learns nothing to adjust to.
  if (d.website && d.website.trim()) return { ok: true };

  const email = normalizeEmail(d.email);
  if (!email) return { ok: false, error: "Enter a valid email." };

  /*
   * Generous per connection, on purpose. Nigerian mobile carriers put many
   * people behind one address, and a "scan to subscribe" QR shown during a
   * service puts the whole congregation on the church Wi-Fi - at 10 an hour
   * the eleventh real person was turned away. This only blunts a script; the
   * per-church cap below and the per-address limit on emails are the guard.
   */
  const ip = await clientIp();
  if (!rateLimit(`newsletter:ip:${ip}`, 60, HOUR).ok)
    return {
      ok: false,
      error: "Too many sign-ups from this connection. Please try again in an hour.",
    };

  const [c] = await db
    .select({ id: church.id, name: church.name, publicEmail: church.publicEmail })
    .from(church)
    .where(and(eq(church.handle, d.handle), eq(church.publicEnabled, true)))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  if (!rateLimit(`newsletter:church:${c.id}`, 100, HOUR).ok)
    return {
      ok: false,
      error: "This church is receiving a lot of sign-ups right now. Please try again later.",
    };

  const name = d.name?.trim().slice(0, 120) || null;

  const [existing] = await db
    .select({ id: subscriber.id, status: subscriber.status })
    .from(subscriber)
    .where(and(eq(subscriber.churchId, c.id), eq(subscriber.email, email)))
    .limit(1);

  /*
   * Somebody who said stop. Whoever is filling in this form may not be them,
   * so the status stays as it is and the address owner decides: one email
   * with a signed link. The reply is the same as any sign-up, so the form
   * does not reveal who has unsubscribed.
   */
  if (existing?.status === "unsubscribed") {
    if (isEmailConfigured() && rateLimit(`newsletter:to:${email}`, 1, 24 * HOUR).ok) {
      const html = emailLayout(
        `Receive emails from ${escapeHtml(c.name)} again?`,
        `<p>Hi,</p><p>Someone asked for this address to receive devotionals, newsletters and updates from <strong>${escapeHtml(c.name)}</strong> again. You unsubscribed earlier, so nothing changes unless you confirm.</p><p style="font-size:12px;color:#9b97ad">If this wasn't you, ignore this email and you will stay unsubscribed.</p>`,
        { label: "Yes, send me these emails", url: resubscribeUrl(c.id, email) },
      );
      const sent = await sendEmail({
        to: email,
        subject: `Confirm: emails from ${c.name}`,
        html,
        fromName: c.name,
        replyTo: c.publicEmail || undefined,
      });
      if (!sent)
        console.error(`[newsletter] re-subscribe confirmation for church ${c.id} was not sent`);
    }
    return { ok: true };
  }

  const alreadyActive = existing?.status === "active";

  await db
    .insert(subscriber)
    .values({ churchId: c.id, name, email, source: "public" })
    .onConflictDoUpdate({
      target: [subscriber.churchId, subscriber.email],
      // Never overwrite a name a church already has: anybody can type into
      // this form, and it would rename a real subscriber in the church's list.
      // Qualified by hand: inside ON CONFLICT a bare "name" is ambiguous
      // between the existing row and the proposed one.
      set: { name: sql`coalesce("subscriber"."name", excluded."name")` },
    });

  if (!alreadyActive) {
    // Instant in-app notification to the church's managers. The typed name is
    // fine here: it is escaped, and only the church's own staff see it.
    await notifyChurchManagers({
      churchId: c.id,
      title: "New newsletter subscriber",
      body: `${name || email} just subscribed to your mailing list.`,
      linkUrl: "/devotionals",
    }).catch((e: unknown) => {
      console.error(`newsletter: manager notify failed for church ${c.id}`, e);
    });

    // Welcome/acknowledgement email to the subscriber - once a day at most
    // per address, and with nothing in it that the caller wrote.
    if (isEmailConfigured() && rateLimit(`newsletter:to:${email}`, 1, 24 * HOUR).ok) {
      const html = emailLayout(
        `You're subscribed to ${escapeHtml(c.name)}`,
        `<p>Hi,</p><p>Thanks for subscribing to <strong>${escapeHtml(c.name)}</strong>. You'll now receive our devotionals, newsletters and updates by email.</p><p style="font-size:12px;color:#9b97ad">Didn't sign up? You can <a href="${unsubscribeUrl(c.id, email)}" style="color:#9b97ad">unsubscribe here</a>.</p>`,
      );
      const sent = await sendEmail({
        to: email,
        subject: `You're subscribed to ${c.name}`,
        html,
        fromName: c.name,
        replyTo: c.publicEmail || undefined,
      });
      if (!sent) console.error(`[newsletter] welcome email for church ${c.id} was not sent`);
    }
  }

  return { ok: true };
}
