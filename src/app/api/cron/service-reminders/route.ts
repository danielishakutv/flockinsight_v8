import { runServiceReminders } from "@/lib/service-reminders";
import { retryPledgeReminderSms, type PledgeSmsRetrySummary } from "@/lib/pledge-reminders";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/service-reminders — every five minutes; also retries failed
 * pledge texts. Sends each church's configured service-day reminders
 * (email/SMS) to members, at most once per service occurrence, and tries a
 * failed text again within its window. Auth via ?key=CRON_SECRET or Bearer
 * header.
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

  try {
    return await withCronRun("service-reminders", async () => {
      const summary = await runServiceReminders();
      /*
       * Pledge texts that failed earlier today are retried here, not in the
       * daily "reminders" job, because a retry is due an hour after the failure
       * and that job runs once a day. It has its own try/catch so a fault in it
       * cannot stop a service reminder. The fault goes into the heartbeat's
       * meta as well as the log, so the health page does not show "ok" over a
       * step that failed.
       */
      let pledge: PledgeSmsRetrySummary | null = null;
      let pledgeSmsRetryError: string | null = null;
      try {
        pledge = await retryPledgeReminderSms();
      } catch (e) {
        pledgeSmsRetryError = e instanceof Error ? e.message : String(e);
        console.error(
          "[cron/service-reminders] pledge SMS retries failed; service reminders were not affected",
          e,
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          ...summary,
          pledgeSmsRetried: pledge?.retried ?? null,
          pledgeSmsRetrySent: pledge?.sent ?? null,
          pledgeSmsRetryFailed: pledge?.failed ?? null,
          pledgeSmsRetryExpired: pledge?.expired ?? null,
          pledgeSmsRetryError,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
  } catch (e) {
    console.error("[cron] service-reminders failed", e);
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
