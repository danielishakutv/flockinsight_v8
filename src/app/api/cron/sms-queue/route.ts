import { flushSmsQueue } from "@/lib/sms-queue";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/sms-queue — run every few minutes.
 *
 * Sends the SMS that was handed in outside the 8am–8pm delivery window. Every
 * minute of delay here is a minute later than the church intended, so this is
 * one of the frequent jobs: at 8am a queue that built up overnight should go
 * out within minutes, not at the top of the hour.
 *
 * Safe to call by hand, and safe to call twice — each row is claimed with a
 * conditional update before anything reaches the gateway.
 *
 * Auth via an `Authorization: Bearer <CRON_SECRET>` header, or `?key=` —
 * prefer the header, because a query string is written to the access log.
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

  return withCronRun("sms-queue", async () => {
    const report = await flushSmsQueue();
    if (report.considered > 0 || report.expired > 0) {
      console.log(
        `[sms-queue] considered ${report.considered}, sent ${report.sent}, held ${report.held}, failed ${report.failed}, expired ${report.expired}`,
      );
    }
    /*
     * Expiry is a LOSS, so it is said loudly and separately. The only way to
     * accumulate expired rows is for this job not to have been running, which
     * is a configuration fault rather than anything a church did.
     */
    if (report.expired > 0) {
      console.error(
        `[sms-queue] ${report.expired} queued batch(es) were older than a day and were not sent. This job may not be scheduled \u2014 check the crontab.`,
      );
    }
    return new Response(JSON.stringify({ ok: true, ...report }), {
      headers: { "Content-Type": "application/json" },
    });
  });
}
