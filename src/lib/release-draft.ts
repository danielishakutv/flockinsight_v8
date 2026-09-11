import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { broadcast, user } from "@/db/schema";
import { APP_VERSION } from "@/lib/version";
import { releases, type Release } from "@/lib/changelog";
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

/*
 * Turning a changelog into an announcement is mostly a matter of leaving
 * things out.
 *
 * The changelog is written for us: every entry in full, including what was
 * broken and why. A church wants none of that. They want to know what they can
 * do this week that they could not do last week, in a few lines they can read
 * on a phone between services. So: keep the wins, cut each to its first
 * clause, cap the list, and reduce the rest to a count — "plus 2 small fixes"
 * reassures, where a paragraph about how giving was miscounted for three weeks
 * does the opposite.
 */

/** The most bullets anyone reads in a notification. */
const MAX_BULLETS = 4;

const TITLE = "What's new in FlockInsight ✨";

/**
 * The first sentence, and only the first.
 *
 * A full stop only ends a sentence when a new one starts after it, which stops
 * money (₦2,000.00) and abbreviations from cutting a line in half.
 */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/[.!?](?=\s+["“(]?[A-Z])/);
  return m?.index === undefined ? t : t.slice(0, m.index + 1);
}

/**
 * One short, readable line from one changelog entry.
 *
 * Our entries tend to state the benefit and then qualify it after an em dash,
 * so when a line runs long the half before the dash is almost always the
 * headline and the half after is the detail.
 */
export function headline(text: string, max = 100): string {
  let s = firstSentence(text);

  if (s.length > max) {
    const dash = s.indexOf(" — ");
    if (dash > 20) s = s.slice(0, dash);
  }

  if (s.length > max) {
    const cut = s.slice(0, max);
    const space = cut.lastIndexOf(" ");
    s = `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }

  // Bullets read better without a full stop; an ellipsis earns its place.
  return s.replace(/[.\s]+$/, "");
}

/** Fixes, changes and security work — counted, not listed. */
function quietCount(r: Release): number {
  return (
    (r.changes.Fixed?.length ?? 0) +
    (r.changes.Changed?.length ?? 0) +
    (r.changes.Security?.length ?? 0)
  );
}

/** What a church gained, in the order they would care about it. */
function wins(r: Release): string[] {
  return [...(r.changes.Added ?? []), ...(r.changes.Improved ?? [])];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function closing(parts: string[]): string {
  const tail = "It's all live — open FlockInsight to take a look.";
  return parts.length ? `Plus ${parts.join(" and ")}. ${tail}` : tail;
}

/** Announce one release. */
export function draftFromRelease(r: Release): { title: string; body: string } {
  const got = wins(r);
  const lines: string[] = [];

  if (r.summary) lines.push(headline(r.summary, 140), "");
  for (const w of got.slice(0, MAX_BULLETS)) lines.push(`• ${headline(w)}`);

  const more = got.length - MAX_BULLETS;
  const quiet = quietCount(r);
  const tail: string[] = [];
  if (more > 0) tail.push(plural(more, "more update", "more updates"));
  if (quiet > 0) tail.push(plural(quiet, "small fix", "small fixes"));

  lines.push("", closing(tail));

  return { title: TITLE, body: clip(lines.join("\n").trim(), 2000) };
}

/**
 * Announce several releases at once, for a church that has not heard from us
 * in a while.
 *
 * One line per release, taken from its summary — that line was already written
 * as the headline for everything in it, so it is the right length and the
 * right voice. A release with no summary falls back to its first win.
 */
export function draftFromReleases(rs: Release[]): {
  title: string;
  body: string;
} {
  const usable = rs.filter((r) => r.summary || wins(r).length > 0);
  if (usable.length === 0) return { title: TITLE, body: "" };
  if (usable.length === 1) return draftFromRelease(usable[0]);

  const lines: string[] = [
    "A lot has landed in FlockInsight lately. Here are the highlights 👇",
    "",
  ];

  for (const r of usable) {
    // One idea per line. A summary often carries two, joined by an em dash
    // ("Refer another church and earn credit — plus readable reports"); in a
    // list of five, the first half alone lands harder.
    const lead = firstSentence(r.summary ?? wins(r)[0]).split(" — ")[0];
    lines.push(`• ${headline(lead, 110)}`);
  }

  const quiet = usable.reduce((n, r) => n + quietCount(r), 0);
  lines.push(
    "",
    closing(
      quiet > 0 ? [`${plural(quiet, "small fix", "small fixes")} along the way`] : [],
    ),
  );

  return { title: TITLE, body: clip(lines.join("\n").trim(), 2000) };
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
