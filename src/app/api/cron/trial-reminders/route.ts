import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/trial-reminders — run daily. Warns churches whose "first 7
 * Sundays free" trial is ending (about 2 weeks, 1 week and 3 days out) to pay
 * or request an extension. Idempotent via church.trialReminderStage.
 * Auth via ?key=CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const due = await db
    .select({
      id: church.id,
      name: church.name,
      trialEndsAt: church.trialEndsAt,
      stage: church.trialReminderStage,
    })
    .from(church)
    .where(
      and(
        isNotNull(church.trialEndsAt),
        eq(church.paymentWaived, false),
        gt(church.trialEndsAt, now),
        or(isNull(church.planRenewsAt), sql`${church.planRenewsAt} < now()`),
      ),
    )
    .limit(500);

  let sent = 0;
  for (const c of due) {
    if (!c.trialEndsAt) continue;
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(c.trialEndsAt).getTime() - now.getTime()) / 86_400_000),
    );
    // Target reminder stage for how close we are.
    const target = daysLeft <= 3 ? 3 : daysLeft <= 7 ? 2 : daysLeft <= 14 ? 1 : 0;
    if (target === 0 || c.stage >= target) continue;

    const link = "/settings/billing";
    const body = `Your church's free trial on FlockInsight ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Choose a plan to keep everything running, or ask us for a little more time.`;

    await notifyChurchManagers({
      churchId: c.id,
      title: `Free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      body,
      linkUrl: link,
    }).catch(() => {});

    if (isEmailConfigured()) {
      const managers = await db
        .selectDistinct({ email: user.email, name: user.name })
        .from(staff)
        .innerJoin(user, eq(user.id, staff.userId))
        .where(
          and(
            eq(staff.organizationId, c.id),
            sql`${staff.role} in ('owner','admin')`,
            eq(staff.temp, false),
          ),
        );
      const html = emailLayout(
        `Your FlockInsight trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        `<p>Hi,</p><p>${c.name} has been enjoying its first 7 Sundays free on FlockInsight. That trial ends in <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong>.</p><p>To keep attendance, members, giving, devotionals and everything else, choose a plan. Need a little more time? Just reply or request an extension in the app and our Head of Missions will take a look.</p>`,
        { label: "Choose a plan", url: `${siteUrl()}${link}` },
      );
      await Promise.all(
        managers.map((m) =>
          sendEmail({ to: m.email, subject: `Your FlockInsight trial ends soon`, html }).catch(
            () => false,
          ),
        ),
      );
    }

    await db
      .update(church)
      .set({ trialReminderStage: target })
      .where(eq(church.id, c.id));
    sent++;
  }

  return new Response(JSON.stringify({ ok: true, reminded: sent }), {
    headers: { "Content-Type": "application/json" },
  });
}
