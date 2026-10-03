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
 * Auth via ?key=CRON_SECRET or a Bearer header.
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
    if (report.considered > 0) {
      console.log(
        `[sms-queue] considered ${report.considered}, sent ${report.sent}, held ${report.held}, failed ${report.failed}`,
      );
    }
    return new Response(JSON.stringify({ ok: true, ...report }), {
      headers: { "Content-Type": "application/json" },
    });
  });
}
