import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { broadcast, user } from "@/db/schema";
import { APP_VERSION } from "@/lib/version";
import { CATEGORY_ORDER, releases, type Release } from "@/lib/changelog";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

/**
 * When a new version goes live, write the announcement — but do not send it.
 *
 * A release note nobody writes is a release nobody hears about, and writing
 * one by hand after every deploy is the job that quietly stops happening. So
 * this drafts it from the changelog automatically and emails the admins a
 * preview of exactly what a church would receive. Nothing reaches a
 * congregation until a human opens it, edits what they want, and presses send.
 *
 * Idempotent twice over: it only acts when APP_VERSION has no draft yet, and
 * `broadcast.sourceVersion` carries a unique index, so two cron ticks racing
 * each other cannot both write one.
 */

/** Turn a changelog entry into something a pastor would want to read. */
export function draftFromRelease(r: Release): { title: string; body: string } {
  const lines: string[] = [];
  if (r.summary) lines.push(r.summary);

  for (const category of CATEGORY_ORDER) {
    const items = r.changes[category];
    if (!items?.length) continue;
    // "Security" and "Changed" matter to us more than to a church; lead with
    // what they actually gain.
    lines.push("", `${category}:`);
    for (const item of items) lines.push(`• ${item}`);
  }

  return {
    title: `What's new in FlockInsight ${r.version}`,
    // Trimmed to the column the composer allows, on a line boundary so it
    // never stops mid-sentence.
    body: clip(lines.join("\n").trim(), 2000),
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}

export type ReleaseDraftResult =
  | { created: false; reason: "no-changelog" | "already-drafted" | "failed" }
  | { created: true; version: string; id: string; notified: number };

/**
 * Create the draft for the running version, if there isn't one, and tell the
 * admins. Safe to call on every cron tick.
 */
export async function ensureReleaseDraft(): Promise<ReleaseDraftResult> {
  try {
    const release = releases.find((r) => r.version === APP_VERSION);
    if (!release) return { created: false, reason: "no-changelog" };

    const existing = await db
      .select({ id: broadcast.id })
      .from(broadcast)
      .where(eq(broadcast.sourceVersion, APP_VERSION))
      .limit(1);
    if (existing.length > 0) return { created: false, reason: "already-drafted" };

    const { title, body } = draftFromRelease(release);

    let row;
    try {
      [row] = await db
        .insert(broadcast)
        .values({
          title,
          body,
          category: "system",
          audience: "all",
          inApp: true,
          email: true,
          scheduledAt: null,
          status: "draft",
          sourceVersion: APP_VERSION,
          linkUrl: `${siteUrl()}/changelog`,
        })
        .returning({ id: broadcast.id });
    } catch {
      // The unique index caught a concurrent tick. That is the other run
      // succeeding, not a failure.
      return { created: false, reason: "already-drafted" };
    }

    const notified = await emailAdminPreview(release.version, title, body, row.id);
    return { created: true, version: APP_VERSION, id: row.id, notified };
  } catch (e) {
    console.error("[release-draft] could not prepare the release draft", e);
    return { created: false, reason: "failed" };
  }
}

/**
 * Email every superadmin the draft as a church would see it.
 *
 * Deliberately the real message rather than a summary of it: the point is to
 * read it the way a pastor will, and decide from that.
 */
async function emailAdminPreview(
  version: string,
  title: string,
  body: string,
  draftId: string,
): Promise<number> {
  const admins = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.isSuperAdmin, true));

  const url = `${siteUrl()}/superadmin/notifications?draft=${draftId}`;
  const escaped = escapeHtml(body).replace(/\n/g, "<br/>");

  let sent = 0;
  for (const a of admins) {
    if (!a.email) continue;
    const ok = await sendEmail({
      to: a.email,
      subject: `Draft ready — announcing FlockInsight ${version}`,
      html: emailLayout(
        `Version ${version} is live. Here is the announcement, unsent.`,
        `<p style="margin:0 0 16px">This is exactly what a church would
           receive. Nothing has been sent — open it to edit the wording, choose
           who gets it, then send or schedule it.</p>
         <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc">
           <p style="margin:0 0 8px;font-weight:700;color:#1a1626">${escapeHtml(title)}</p>
           <div style="font-size:14px;line-height:1.6;color:#4b4661">${escaped}</div>
         </div>`,
        { label: "Review the draft", url },
      ),
      text: `Version ${version} is live.\n\nDraft announcement (not sent):\n\n${title}\n\n${body}\n\nReview: ${url}`,
    });
    if (ok) sent++;
  }
  return sent;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
