import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  notification,
  notificationReceipt,
  notificationTarget,
} from "@/db/schema";
import {
  resolveAudienceUserIds,
  resolveAudienceUsers,
} from "@/lib/notifications";
import { sendPushToUsers } from "@/lib/push";
import { sendEmailWithId, emailLayout } from "@/lib/mailer";
import { richTextToEmailHtml, richTextToPlain } from "@/lib/rich-text";
import { isFullHtmlDocument } from "@/lib/rich-text-shared";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Replace the {name} tag with a recipient's first name (or a neutral word). */
function fillName(text: string, name?: string | null): string {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  return text.replace(/\{name\}/g, first);
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

  // In-app + push reach many people at once, so they can't be personalised —
  // use a neutral greeting there. Email is personalised per recipient below.
  const neutralTitle = fillName(d.title);
  /*
   * The stored body may carry formatting. The notification centre and a push
   * banner both render text, so they get the words: a push reading
   * "<p><strong>Good news</strong></p>" is worse than no push at all.
   */
  const neutralBody = richTextToPlain(fillName(d.body));

  /*
   * Every send is recorded, whichever channels it used.
   *
   * An email-only broadcast used to write nothing at all: it never appeared in
   * the admin history, and there was no row for a delivery receipt to hang
   * from. `inApp` decides whether churches see it in their notification
   * centre; it no longer decides whether the send is remembered.
   */
  const [row] = await db
    .insert(notification)
    .values({
      title: neutralTitle,
      body: neutralBody,
      // The body as written. `body` above is flattened for push banners and
      // the notification centre; this is what reuse needs to restore.
      sourceBody: d.body,
      category: d.category,
      audience: d.audience,
      targetPlan: d.audience === "plan" ? (d.targetPlan as "starter") : null,
      targetCountry: d.audience === "country" ? d.targetCountry : null,
      linkUrl: d.linkUrl ?? null,
      inApp: d.inApp,
      createdBy: d.createdBy ?? null,
    })
    .returning({ id: notification.id });

  if (d.audience === "churches" && churchIds.length > 0) {
    await db
      .insert(notificationTarget)
      .values(churchIds.map((churchId) => ({ notificationId: row.id, churchId })))
      .onConflictDoNothing();
  }

  if (d.inApp) {
    const userIds = await resolveAudienceUserIds({
      audience: d.audience,
      targetPlan: d.targetPlan,
      targetCountry: d.targetCountry,
      churchIds,
    });
    pushSent = await sendPushToUsers(userIds, {
      title: neutralTitle,
      body: neutralBody,
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
    const results = await Promise.allSettled(
      recipients.map(async (r) => {
        // Personalise per recipient: {name} → their first name.
        const subject = fillName(d.title, r.name);
        const body = fillName(d.body, r.name);
        // Already sanitised on the way in; this re-runs it rather than
        // trusting a row that might predate the editor, or have been written
        // straight into the database.
        const rendered = richTextToEmailHtml(body);
        /*
         * A pasted template is the whole email.
         *
         * It arrives with its own <html>, its own width, its own colours and
         * its own footer. Nesting that inside our standard frame would put a
         * document inside a div — invalid, and rendered differently by every
         * client that tries — and would staple our header and CTA onto a
         * design that already has both.
         */
        const html = isFullHtmlDocument(rendered)
          ? rendered
          : emailLayout(escapeHtml(subject), rendered, {
              label: "Open FlockInsight",
              url: linkAbs,
            });
        // A text/plain part every client can read, formatting or not.
        const text = richTextToPlain(body);
        /*
         * sendEmailWithId rather than sendEmail, for the provider's message id.
         *
         * That id is the only thing a delivery webhook can match on reliably —
         * an address is not unique enough once somebody changes theirs, and a
         * bounce report may arrive days later.
         */
        const sent = await sendEmailWithId({ to: r.email, subject, html, text });
        return { r, sent };
      }),
    );

    const receipts: (typeof notificationReceipt.$inferInsert)[] = [];
    for (const out of results) {
      if (out.status !== "fulfilled") continue;
      const { r, sent } = out.value;
      if (sent.ok) emailSent++;
      receipts.push({
        notificationId: row.id,
        userId: r.userId,
        churchId: r.churchId,
        name: r.name,
        email: r.email,
        // "sent" means we handed it over. Only the provider's webhook can
        // upgrade that to delivered, or tell us it bounced.
        status: sent.ok ? "sent" : "failed",
        providerMessageId: sent.id,
        error: sent.ok ? null : "The provider rejected it",
      });
    }
    if (receipts.length > 0) {
      // Best-effort: a send that happened must not be reported as failed
      // because we could not write down who it went to.
      await db.insert(notificationReceipt).values(receipts).catch((e) => {
        console.error("[broadcast] could not record receipts", e);
      });
    }
  }

  return { pushSent, emailSent };
}
