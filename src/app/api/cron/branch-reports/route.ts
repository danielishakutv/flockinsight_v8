import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hqReportSetting } from "@/db/schema";
import {
  REPORT_RANGE,
  branchStats,
  churchTeamEmails,
  dueReportSettings,
  rollUp,
} from "@/lib/branches";
import { ALL } from "@/lib/branches-shared";
import { branchReportEmail } from "@/lib/branch-report-email";
import { sendEmail } from "@/lib/mailer";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/branch-reports — run daily. Emails each headquarters its
 * branch roll-up when one is due (weekly or monthly, per their setting).
 * Auth via ?key=CRON_SECRET or a Bearer header.
 *
 * Due-ness is stored as `lastSentAt`, so a missed day sends late rather than
 * never, and a double run in one day sends once.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  return withCronRun("branch-reports", async () => {
    const due = await dueReportSettings();
    let sent = 0;
    let skipped = 0;

    for (const setting of due) {
      const range = REPORT_RANGE[setting.frequency];
      const { rows } = await branchStats(setting.churchId, {
        range,
        zone: ALL,
        state: ALL,
        city: ALL,
        country: ALL,
        q: "",
      });

      // A headquarters with no branches has nothing to report; leave the
      // timestamp alone so it sends as soon as it has one.
      if (rows.length === 0) {
        skipped++;
        continue;
      }

      const { subject, html, text } = branchReportEmail({
        churchName: setting.churchName,
        currency: setting.currency,
        range,
        rows,
        totals: rollUp(rows),
      });

      const team = await churchTeamEmails(setting.churchId);
      const extra = Array.isArray(setting.recipients) ? setting.recipients : [];
      const to = [...new Set([...team, ...extra])];

      // Nobody to send to: leave the timestamp alone so it goes out as soon as
      // this church has someone who can receive it, rather than silently
      // "sending" into thin air and waiting another week.
      if (to.length === 0) {
        skipped++;
        continue;
      }

      const results = await Promise.allSettled(
        to.map((address) =>
          sendEmail({
            to: address,
            subject,
            html,
            text,
            fromName: setting.churchName,
          }),
        ),
      );
      const delivered = results.filter(
        (r) => r.status === "fulfilled" && r.value,
      ).length;
      if (delivered > 0) sent++;

      await db
        .update(hqReportSetting)
        .set({ lastSentAt: new Date() })
        .where(eq(hqReportSetting.churchId, setting.churchId));
    }

    return Response.json({ ok: true, due: due.length, sent, skipped });
  });
}
