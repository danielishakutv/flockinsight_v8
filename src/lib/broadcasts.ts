import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notification, notificationTarget } from "@/db/schema";
import {
  resolveAudienceUserIds,
  resolveAudienceUsers,
} from "@/lib/notifications";
import { sendPushToUsers } from "@/lib/push";
import { sendEmail, emailLayout } from "@/lib/mailer";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type BroadcastAudience = "all" | "plan" | "country" | "churches";

export type DeliverInput = {
  title: string;
  body: string;
  category: "system" | "general";
  audience: BroadcastAudience;
  targetPlan?: string | null;
  targetCountry?: string | null;
  churchIds?: string[];
  linkUrl?: string | null;
  inApp: boolean;
  email: boolean;
  createdBy?: string | null;
};

/**
 * Deliver a broadcast now: an in-app notification (+ web push) and/or email,
 * to the chosen audience. Shared by "send now" and the scheduled-broadcast cron.
 */
export async function deliverBroadcast(
  d: DeliverInput,
): Promise<{ pushSent: number; emailSent: number }> {
  const churchIds = d.churchIds ?? [];
  let pushSent = 0;
  let emailSent = 0;

  if (d.inApp) {
    const [row] = await db
      .insert(notification)
      .values({
        title: d.title,
        body: d.body,
        category: d.category,
        audience: d.audience,
        targetPlan: d.audience === "plan" ? (d.targetPlan as "starter") : null,
        targetCountry: d.audience === "country" ? d.targetCountry : null,
        linkUrl: d.linkUrl ?? null,
        createdBy: d.createdBy ?? null,
      })
      .returning({ id: notification.id });

    if (d.audience === "churches" && churchIds.length > 0) {
      await db
        .insert(notificationTarget)
        .values(churchIds.map((churchId) => ({ notificationId: row.id, churchId })))
        .onConflictDoNothing();
    }

    const userIds = await resolveAudienceUserIds({
      audience: d.audience,
      targetPlan: d.targetPlan,
      targetCountry: d.targetCountry,
      churchIds,
    });
    pushSent = await sendPushToUsers(userIds, {
      title: d.title,
      body: d.body,
      url: d.linkUrl || "/notifications",
      tag: row.id,
    });
    if (pushSent > 0) {
      await db
        .update(notification)
        .set({ pushSent })
        .where(eq(notification.id, row.id));
    }
  }

  if (d.email) {
    const recipients = await resolveAudienceUsers({
      audience: d.audience,
      targetPlan: d.targetPlan,
      targetCountry: d.targetCountry,
      churchIds,
    });
    const linkAbs = d.linkUrl
      ? d.linkUrl.startsWith("http")
        ? d.linkUrl
        : `${BASE_URL}${d.linkUrl}`
      : `${BASE_URL}/notifications`;
    const html = emailLayout(
      escapeHtml(d.title),
      `<p>${escapeHtml(d.body).replace(/\n/g, "<br/>")}</p>`,
      { label: "Open FlockInsight", url: linkAbs },
    );
    const results = await Promise.allSettled(
      recipients.map((r) =>
        sendEmail({ to: r.email, subject: d.title, html, text: d.body }),
      ),
    );
    emailSent = results.filter((x) => x.status === "fulfilled" && x.value).length;
  }

  return { pushSent, emailSent };
}
