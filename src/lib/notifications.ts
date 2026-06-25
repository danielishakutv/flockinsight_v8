import "server-only";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  notification,
  notificationRead,
  notificationTarget,
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
  const targeted = sql`exists (select 1 from notification_target nt where nt.notification_id = ${notification.id} and nt.church_id = ${ctx.churchId})`;
  return or(
    eq(notification.audience, "all"),
    and(eq(notification.audience, "plan"), eq(notification.targetPlan, ctx.plan as "starter")),
    and(
      eq(notification.audience, "country"),
      eq(notification.targetCountry, ctx.country),
    ),
    and(eq(notification.audience, "churches"), targeted),
  ) as SQL;
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
