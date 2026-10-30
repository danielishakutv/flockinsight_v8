import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";
import { withCronRun } from "@/lib/cron-run";
// A church writes its own name, and it ends up inside an HTML email to its
// own managers. Nothing stops somebody typing a tag into it.
import { escapeHtml } from "@/lib/html-escape";
import { normalizePhone, sendSms } from "@/lib/sms";
import { localHour, withinSmsWindow } from "@/lib/sms-window";
import { smsAvailableForCountry } from "@/lib/country-profile";
import {
  EMAIL_HOURS,
  TRIAL_EMAIL_LADDER,
  timeLeftPhrase,
  trialEmailDue,
  trialEndLabel,
  trialSmsDue,
} from "@/lib/trial-reminders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/trial-reminders — run hourly. Warns churches whose "first 7
 * Sundays free" trial is ending, by email at 14, 7, 3, 2 and 1 days and 3 hours
 * out, and by SMS at 7, 3 and 1 days inside the delivery window — the ladder
 * and its hours are in lib/trial-reminders.ts. Idempotent via
 * church.trialReminderStage and church.trialSmsStage. Hourly so the last
 * warning can come hours before the lock rather than days.
 * Auth via ?key=CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });

  return withCronRun("trial-reminders", async () => {
  const now = new Date();
  const due = await db
    .select({
      id: church.id,
      name: church.name,
      trialEndsAt: church.trialEndsAt,
      stage: church.trialReminderStage,
      smsStage: church.trialSmsStage,
      timezone: church.timezone,
      country: church.country,
      contactEmail: church.contactEmail,
      contactPhone: church.contactPhone,
    })
    .from(church)
    .where(
      and(
        isNotNull(church.trialEndsAt),
        /*
         * Not comped RIGHT NOW — which is not the same as "not comped".
         *
         * A waiver can carry a deadline, and a church whose comp has run out is
         * exactly the one that needs to hear from us. Checking only the flag
         * would leave it silently un-nudged for ever after the comp lapsed.
         */
        or(
          eq(church.paymentWaived, false),
          and(
            isNotNull(church.paymentWaivedUntil),
            sql`${church.paymentWaivedUntil} < now()`,
          ),
        ),
        gt(church.trialEndsAt, now),
        // Inside the last fortnight: nothing earlier is ever due, and an
        // hourly job should not read every church on a trial to find that out.
        sql`${church.trialEndsAt} <= ${new Date(now.getTime() + 14 * 86_400_000).toISOString()}::timestamptz`,
        or(isNull(church.planRenewsAt), sql`${church.planRenewsAt} < now()`),
        eq(church.isDemo, false),
      ),
    )
    .limit(500);

  let sent = 0;
  let texted = 0;
  const smsReady = Boolean(process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID);
  for (const c of due) {
    if (!c.trialEndsAt) continue;
    const endsAt = new Date(c.trialEndsAt);
    const msLeft = endsAt.getTime() - now.getTime();
    const emailStage = trialEmailDue(msLeft, localHour(now, c.timezone), c.stage);
    const smsStage =
      smsReady && smsAvailableForCountry(c.country)
        ? trialSmsDue(msLeft, withinSmsWindow(now, c.timezone), c.smsStage)
        : null;
    if (emailStage === null && smsStage === null) continue;

    const left = timeLeftPhrase(msLeft);
    const when = trialEndLabel(endsAt, c.timezone);
    const link = "/settings/billing";

    // Owners and admins, never a superadmin's temporary seat.
    const managers = await db
      .selectDistinct({ email: user.email, phone: user.phone })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .where(
        and(
          eq(staff.organizationId, c.id),
          sql`${staff.role} in ('owner','admin')`,
          eq(staff.temp, false),
        ),
      );

    if (emailStage !== null) {
      const final = emailStage === TRIAL_EMAIL_LADDER[TRIAL_EMAIL_LADDER.length - 1].stage;
      await notifyChurchManagers({
        churchId: c.id,
        title: `Free trial ends ${left}`,
        body: `Your free trial ends ${when}. Choose a plan to keep everything running, or ask us for a little more time.`,
        linkUrl: link,
      }).catch((e: unknown) => {
        console.error(`trial-reminders: in-app notify failed for church ${c.id}`, e);
      });

      if (isEmailConfigured()) {
        // The church's own contact address too, once, if nobody on the team
        // already has it.
        const to = [
          ...new Set(
            [...managers.map((m) => m.email), c.contactEmail ?? ""]
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
        const html = emailLayout(
          `Your FlockInsight trial ends ${left}`,
          `<p>Hi,</p><p>${escapeHtml(c.name)}'s free trial on FlockInsight ends <strong>${escapeHtml(when)}</strong> — ${escapeHtml(left)}.</p>` +
            (final
              ? `<p>After that, attendance, members, giving and everything else stay safe but locked until a plan is chosen. It takes a minute from the link below.</p>`
              : `<p>To keep attendance, members, giving and everything else running without a break, choose a plan. Need a little more time? Reply to this email or request an extension in the app.</p>`),
          { label: "Choose a plan", url: `${siteUrl()}${link}` },
        );
        await Promise.all(
          to.map((email) =>
            sendEmail({
              to: email,
              subject: final
                ? "Last reminder: your FlockInsight trial ends in a few hours"
                : `Your FlockInsight trial ends ${left}`,
              html,
            }).catch((e: unknown) => {
              console.error(`trial-reminders: email to a manager of ${c.id} failed`, e);
              return false;
            }),
          ),
        );
      }

      await db
        .update(church)
        .set({ trialReminderStage: emailStage })
        .where(eq(church.id, c.id));
      sent++;
    }

    if (smsStage !== null) {
      /*
       * The church's account number, and any number a manager has verified on
       * their own login. Sent from FlockInsight's sender ID and paid for by the
       * platform, not from the church's wallet: this is us telling them
       * something, not them telling their members.
       */
      const phones = [
        ...new Set(
          [c.contactPhone, ...managers.map((m) => m.phone)]
            .map((p) => (p ? normalizePhone(p) : null))
            .filter((p): p is string => !!p),
        ),
      ];
      if (phones.length > 0) {
        const res = await sendSms({
          to: phones,
          message: `FlockInsight: ${c.name}'s free trial ends ${left} (${when}). Choose a plan to keep everything running: ${siteUrl()}${link}`,
        });
        if (!res.ok) {
          console.error(`trial-reminders: SMS for church ${c.id} failed: ${res.error}`);
        } else {
          texted++;
        }
      }
      // Recorded either way, so one unreachable number is not retried every
      // hour; the email and the in-app notice carry the same message.
      await db
        .update(church)
        .set({ trialSmsStage: smsStage })
        .where(eq(church.id, c.id));
    }
  }

  /*
   * Second pass: comps that are about to run out.
   *
   * A waiver with a deadline ends in silence otherwise — the church simply
   * finds itself asked to pay one morning, having been told months ago that
   * FlockInsight was free for them. Same ladder as the trial (14/7/3 days),
   * same idempotence, its own stage column.
   */
  const waiverDue = await db
    .select({
      id: church.id,
      name: church.name,
      until: church.paymentWaivedUntil,
      stage: church.waiverReminderStage,
      timezone: church.timezone,
    })
    .from(church)
    .where(
      and(
        eq(church.paymentWaived, true),
        isNotNull(church.paymentWaivedUntil),
        gt(church.paymentWaivedUntil, now),
      ),
    )
    .limit(500);

  let waiverReminded = 0;
  for (const c of waiverDue) {
    if (!c.until) continue;
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(c.until).getTime() - now.getTime()) / 86_400_000),
    );
    const target = daysLeft <= 3 ? 3 : daysLeft <= 7 ? 2 : daysLeft <= 14 ? 1 : 0;
    if (target === 0 || c.stage >= target) continue;
    // The job is hourly now; a days-out notice waits for the church's daytime.
    const hour = localHour(now, c.timezone);
    if (hour < EMAIL_HOURS.start || hour >= EMAIL_HOURS.end) continue;

    const dayWord = `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    const link = "/settings/billing";

    await notifyChurchManagers({
      churchId: c.id,
      title: `Your complimentary access ends in ${dayWord}`,
      body: `FlockInsight has been free for ${c.name} as our gift. That ends in ${dayWord} — choose a plan now and nothing will be interrupted.`,
      linkUrl: link,
    }).catch((e: unknown) => {
      console.error(`trial-reminders: waiver notify failed for church ${c.id}`, e);
    });

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
        `Your complimentary access ends in ${dayWord}`,
        `<p>Hi,</p><p>FlockInsight has been on us for <strong>${escapeHtml(c.name)}</strong>. That complimentary period ends in <strong>${dayWord}</strong>.</p><p>Choose a plan before then and nothing changes — your attendance, members, giving and everything else carry straight on. If you'd like us to extend it, just reply to this email.</p>`,
        { label: "Choose a plan", url: `${siteUrl()}${link}` },
      );
      await Promise.all(
        managers.map((m) =>
          sendEmail({
            to: m.email,
            subject: "Your FlockInsight complimentary access ends soon",
            html,
          }).catch(() => false),
        ),
      );
    }

    await db
      .update(church)
      .set({ waiverReminderStage: target })
      .where(eq(church.id, c.id));
    waiverReminded++;
  }

  return new Response(
    JSON.stringify({ ok: true, reminded: sent, texted, waiverReminded }),
    { headers: { "Content-Type": "application/json" } },
  );
  });
}
