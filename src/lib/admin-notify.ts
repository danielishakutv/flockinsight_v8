import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { emailLayout } from "@/lib/mailer";
import { notifyChurchManagers } from "@/lib/notifications";
import { siteUrl } from "@/lib/site";

/**
 * Telling a church when the FlockInsight team changes something on its account.
 *
 * The gap this closes: a superadmin could extend a trial, move a plan, credit
 * a wallet or suspend an account and the church would learn about it only by
 * noticing. Anything a church would reasonably want to hear about goes through
 * here, so there is one wording, one look and one place to audit what we tell
 * people.
 *
 * Every notice reaches them three ways — in-app, push, and email — because the
 * ones that matter most (suspension, a plan change) are exactly the ones a
 * church is least likely to be in the app to see.
 *
 * Best-effort by design: it never throws, so a mail outage can't roll back the
 * admin action that had already succeeded.
 */

export type AdminNotice = {
  churchId: string;
  /** Headline, e.g. "Free trial extended". Also the in-app notification title. */
  title: string;
  /** One or two plain sentences. No HTML — it's escaped. */
  body: string;
  /** Where in the app the change shows, e.g. "/settings/billing". */
  linkUrl?: string | null;
  /** Email subject. Defaults to the title. */
  subject?: string;
  /** Facts worth spelling out, rendered as a small table in the email. */
  details?: { label: string; value: string }[];
  /** The operator's own note/reason, shown to the church verbatim. */
  note?: string | null;
  /** Label for the email's button. Defaults to "Open FlockInsight". */
  ctaLabel?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function detailsTable(details: { label: string; value: string }[]): string {
  if (!details.length) return "";
  const rows = details
    .map(
      (d) =>
        `<tr>` +
        `<td style="padding:6px 12px 6px 0;color:#8a86a0;font-size:13px;white-space:nowrap">${escapeHtml(d.label)}</td>` +
        `<td style="padding:6px 0;font-size:13px;font-weight:700;color:#1a1626">${escapeHtml(d.value)}</td>` +
        `</tr>`,
    )
    .join("");
  return `<table style="margin:16px 0;border-collapse:collapse;width:100%">${rows}</table>`;
}

/**
 * Send one admin-action notice to a church's owner/admins and to its account
 * email. Never throws.
 */
export async function notifyChurchOfAdminAction(opts: AdminNotice): Promise<void> {
  try {
    const [c] = await db
      .select({ name: church.name, contactEmail: church.contactEmail })
      .from(church)
      .where(eq(church.id, opts.churchId))
      .limit(1);
    if (!c) return;

    const support = `${siteUrl()}/help/support`;
    const html = emailLayout(
      opts.title,
      `<p style="margin:0 0 12px">Hello ${escapeHtml(c.name)},</p>` +
        `<p style="margin:0">${escapeHtml(opts.body)}</p>` +
        detailsTable(opts.details ?? []) +
        (opts.note
          ? `<div style="margin:16px 0;padding:12px 14px;border-left:3px solid #5b3df5;background:#f6f4ff;border-radius:0 8px 8px 0">` +
            `<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#5b3df5;text-transform:uppercase;letter-spacing:.04em">Note from the team</p>` +
            `<p style="margin:0;font-size:14px">${escapeHtml(opts.note)}</p>` +
            `</div>`
          : "") +
        `<p style="margin:16px 0 0;font-size:13px;color:#8a86a0">` +
        `This change was made by the FlockInsight team. If it looks wrong, ` +
        `<a href="${support}" style="color:#5b3df5">open a support ticket</a> and we'll sort it out.` +
        `</p>`,
      opts.linkUrl
        ? {
            label: opts.ctaLabel ?? "Open FlockInsight",
            url: `${siteUrl()}${opts.linkUrl}`,
          }
        : undefined,
    );

    await notifyChurchManagers({
      churchId: opts.churchId,
      title: opts.title,
      body: opts.note ? `${opts.body} — ${opts.note}` : opts.body,
      linkUrl: opts.linkUrl ?? null,
      email: { subject: opts.subject ?? opts.title },
      emailHtml: html,
      alsoEmail: [c.contactEmail],
    });
  } catch (e) {
    console.error("[admin-notify] failed", e);
  }
}

/**
 * The same notice, but for a church that is about to stop existing.
 *
 * Deleting a church cascades away its staff rows, so there is nobody left to
 * look up afterwards — the addresses have to be captured and mailed BEFORE the
 * delete. There's no in-app notification: there'd be no app to read it in.
 */
export async function emailChurchBeforeDeletion(opts: {
  churchId: string;
  churchName: string;
  note?: string | null;
}): Promise<void> {
  try {
    const { sendEmail, isEmailConfigured } = await import("@/lib/mailer");
    if (!isEmailConfigured()) return;
    const { staff, user } = await import("@/db/schema");

    const [[c], managers] = await Promise.all([
      db
        .select({ contactEmail: church.contactEmail })
        .from(church)
        .where(eq(church.id, opts.churchId))
        .limit(1),
      db
        .select({ email: user.email })
        .from(staff)
        .innerJoin(user, eq(user.id, staff.userId))
        .where(eq(staff.organizationId, opts.churchId)),
    ]);

    const emails = [
      ...new Set(
        [...managers.map((m) => m.email), c?.contactEmail]
          .filter((e): e is string => !!e && e.includes("@"))
          .map((e) => e.trim().toLowerCase()),
      ),
    ];
    if (!emails.length) return;

    const html = emailLayout(
      "Your FlockInsight church account has been closed",
      `<p style="margin:0 0 12px">Hello ${escapeHtml(opts.churchName)},</p>` +
        `<p style="margin:0">Your church account and all of its data have been permanently removed from FlockInsight. This cannot be undone.</p>` +
        (opts.note
          ? `<p style="margin:12px 0 0"><b>Reason:</b> ${escapeHtml(opts.note)}</p>`
          : "") +
        `<p style="margin:16px 0 0;font-size:13px;color:#8a86a0">If this wasn't expected, reply to this email straight away and we'll help.</p>`,
    );

    await Promise.allSettled(
      emails.map((to) =>
        sendEmail({
          to,
          subject: "Your FlockInsight church account has been closed",
          html,
          text: `Your FlockInsight church account (${opts.churchName}) and all of its data have been permanently removed.`,
        }),
      ),
    );
  } catch (e) {
    console.error("[admin-notify] emailChurchBeforeDeletion failed", e);
  }
}
