import "server-only";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  notification,
  notificationRead,
  staff,
  user,
} from "@/db/schema";

export type NotificationCtx = {
  churchId: string;
  plan: string;
  country: string;
  userId: string;
};

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  category: "system" | "general";
  linkUrl: string | null;
  createdAt: Date;
  read: boolean;
};

/** SQL predicate: notifications whose audience includes this church. */
function audienceFilter(ctx: NotificationCtx): SQL {
  // sql-qualified-ok: this template is used as a WHERE predicate, and in that
  // position drizzle renders the column fully qualified — the generated SQL is
  // `nt.notification_id = "notification"."id"`, so the outer reference
  // survives. The same template in a SELECT-field position would render a bare
  // `"id"` and silently bind it to `nt` instead; see lib/sql-safety.test.ts.
  // `${ctx.churchId}` is a bound parameter, not a column, so it is unaffected.
  const targeted = sql`exists (select 1 from notification_target nt where nt.notification_id = ${notification.id} and nt.church_id = ${ctx.churchId})`;
  return or(
    eq(notification.audience, "all"),
    and(eq(notification.audience, "plan"), eq(notification.targetPlan, ctx.plan as "starter")),
    and(
      eq(notification.audience, "country"),
      eq(notification.targetCountry, ctx.country),
    ),
    and(eq(notification.audience, "churches"), targeted),
    // Personal notifications addressed to this user (e.g. follow-up assigned).
    and(eq(notification.audience, "user"), eq(notification.targetUserId, ctx.userId)),
  ) as SQL;
}

/**
 * Create an in-app notification addressed to a single user, and push it to
 * their devices. Used for per-user app events (e.g. follow-up assignment).
 * Never throws — notifications must not break the triggering action.
 */
export async function notifyUser(opts: {
  userId: string;
  title: string;
  body: string;
  linkUrl?: string | null;
  category?: "system" | "general";
}): Promise<void> {
  try {
    await db.insert(notification).values({
      title: opts.title,
      body: opts.body,
      category: opts.category ?? "general",
      audience: "user",
      targetUserId: opts.userId,
      linkUrl: opts.linkUrl ?? null,
    });
    const { sendPushToUsers } = await import("@/lib/push");
    await sendPushToUsers([opts.userId], {
      title: opts.title,
      body: opts.body,
      url: opts.linkUrl ?? "/notifications",
      tag: "fi-personal",
    });
  } catch (e) {
    console.error("[notify] notifyUser failed", e);
  }
}

/**
 * Notify a church's managers (owner + admins) about a team / account change:
 * in-app + push always, and email too when `email` is set — use it for things
 * they'd want to hear about even if they aren't in the app, like an SMS sender
 * ID being approved. Never throws.
 */
export async function notifyChurchManagers(opts: {
  churchId: string;
  title: string;
  body: string;
  linkUrl?: string | null;
  excludeUserId?: string;
  /** Also email them. `true` uses `title` as the subject. */
  email?: boolean | { subject: string };
  /** Replaces the default email body. Ignored unless `email` is set. */
  emailHtml?: string;
  /**
   * Extra addresses to copy, deduped against the managers' own — e.g. the
   * church's verified account email, which may belong to nobody's login.
   */
  alsoEmail?: (string | null | undefined)[];
}): Promise<void> {
  try {
    const rows = await db
      .select({ userId: staff.userId, email: user.email })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .where(
        and(
          eq(staff.organizationId, opts.churchId),
          inArray(staff.role, ["owner", "admin"]),
          eq(staff.temp, false),
        ),
      );
    const managers = rows.filter((r) => r.userId !== opts.excludeUserId);
    const ids = [...new Set(managers.map((r) => r.userId))];

    if (!ids.length)
      console.warn(
        `[notify] church ${opts.churchId} has no owner/admin to notify: "${opts.title}"`,
      );

    await Promise.all(
      ids.map((id) =>
        notifyUser({
          userId: id,
          title: opts.title,
          body: opts.body,
          linkUrl: opts.linkUrl,
        }),
      ),
    );

    if (!opts.email) return;
    const { sendEmail, emailLayout, isEmailConfigured } = await import("@/lib/mailer");
    if (!isEmailConfigured()) {
      console.warn(`[notify] email not configured — skipped "${opts.title}"`);
      return;
    }
    const { siteUrl } = await import("@/lib/site");
    const subject = typeof opts.email === "object" ? opts.email.subject : opts.title;
    const cta = opts.linkUrl
      ? { label: "Open FlockInsight", url: `${siteUrl()}${opts.linkUrl}` }
      : undefined;
    const html = opts.emailHtml ?? emailLayout(opts.title, opts.body, cta);
    const emails = [
      ...new Set(
        [...managers.map((r) => r.email), ...(opts.alsoEmail ?? [])]
          .filter((e): e is string => !!e && e.includes("@"))
          .map((e) => e.trim().toLowerCase()),
      ),
    ];
    const sent = await Promise.allSettled(
      emails.map((to) => sendEmail({ to, subject, html, text: opts.body })),
    );
    const failed = sent.filter((r) => r.status === "rejected" || r.value === false);
    if (failed.length)
      console.error(
        `[notify] ${failed.length}/${emails.length} emails failed for "${subject}"`,
      );
  } catch (e) {
    console.error("[notify] notifyChurchManagers failed", e);
  }
}

/**
 * Email all platform superadmins (e.g. to alert them of a new SMS sender-ID
 * request that needs review). Best-effort — never throws.
 */
export async function notifySuperAdminsByEmail(opts: {
  subject: string;
  title: string;
  body: string;
  linkPath?: string;
}): Promise<void> {
  try {
    const { sendEmail, emailLayout, isEmailConfigured } = await import("@/lib/mailer");
    if (!isEmailConfigured()) return;
    const { siteUrl } = await import("@/lib/site");
    const admins = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.isSuperAdmin, true));
    const cta = opts.linkPath
      ? { label: "Open admin", url: `${siteUrl()}${opts.linkPath}` }
      : undefined;
    const html = emailLayout(opts.title, opts.body, cta);
    await Promise.allSettled(
      admins.map((a) =>
        sendEmail({ to: a.email, subject: opts.subject, html, text: opts.body }),
      ),
    );
  } catch (e) {
    console.error("[notify] notifySuperAdminsByEmail failed", e);
  }
}

export async function listNotifications(
  ctx: NotificationCtx,
  opts?: { category?: "system" | "general"; limit?: number },
): Promise<NotificationItem[]> {
  const where = opts?.category
    ? and(audienceFilter(ctx), eq(notification.category, opts.category))
    : audienceFilter(ctx);

  const rows = await db
    .select({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      category: notification.category,
      linkUrl: notification.linkUrl,
      createdAt: notification.createdAt,
      readAt: notificationRead.readAt,
    })
    .from(notification)
    .leftJoin(
      notificationRead,
      and(
        eq(notificationRead.notificationId, notification.id),
        eq(notificationRead.userId, ctx.userId),
      ),
    )
    .where(where)
    .orderBy(desc(notification.createdAt))
    .limit(opts?.limit ?? 100);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    category: r.category,
    linkUrl: r.linkUrl,
    createdAt: r.createdAt,
    read: r.readAt !== null,
  }));
}

export async function unreadCount(ctx: NotificationCtx): Promise<number> {
  const [r] = await db
    .select({ c: count() })
    .from(notification)
    .leftJoin(
      notificationRead,
      and(
        eq(notificationRead.notificationId, notification.id),
        eq(notificationRead.userId, ctx.userId),
      ),
    )
    .where(and(audienceFilter(ctx), isNull(notificationRead.id)));
  return Number(r?.c ?? 0);
}

/** Resolve the distinct staff user-ids that should receive a push. */
export async function resolveAudienceUserIds(input: {
  audience: "all" | "plan" | "country" | "churches";
  targetPlan?: string | null;
  targetCountry?: string | null;
  churchIds?: string[];
}): Promise<string[]> {
  const base = db
    .selectDistinct({ userId: staff.userId })
    .from(staff)
    .innerJoin(church, eq(church.id, staff.organizationId));

  let rows: { userId: string }[] = [];
  if (input.audience === "all") {
    rows = await base;
  } else if (input.audience === "plan" && input.targetPlan) {
    rows = await base.where(eq(church.plan, input.targetPlan as "starter"));
  } else if (input.audience === "country" && input.targetCountry) {
    rows = await base.where(eq(church.country, input.targetCountry));
  } else if (input.audience === "churches" && input.churchIds?.length) {
    rows = await base.where(inArray(staff.organizationId, input.churchIds));
  }
  return rows.map((r) => r.userId);
}

/** Like resolveAudienceUserIds, but returns email/name for email delivery. */
export async function resolveAudienceUsers(input: {
  audience: "all" | "plan" | "country" | "churches";
  targetPlan?: string | null;
  targetCountry?: string | null;
  churchIds?: string[];
}): Promise<{ email: string; name: string }[]> {
  const base = db
    .selectDistinct({ email: user.email, name: user.name })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .innerJoin(church, eq(church.id, staff.organizationId));

  if (input.audience === "all") return base;
  if (input.audience === "plan" && input.targetPlan)
    return base.where(eq(church.plan, input.targetPlan as "starter"));
  if (input.audience === "country" && input.targetCountry)
    return base.where(eq(church.country, input.targetCountry));
  if (input.audience === "churches" && input.churchIds?.length)
    return base.where(inArray(staff.organizationId, input.churchIds));
  return [];
}
