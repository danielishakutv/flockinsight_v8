import { withCronRun } from "@/lib/cron-run";
import { retryStatusEmails, runPartnerDigests } from "@/lib/partner-digest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/partner-emails — hourly at :15.
 *
 * Two jobs, both about telling Partners things:
 *
 * - Status emails that did not go through when superadmin made the change are
 *   retried every hour for three days (see retryStatusEmails).
 * - On Mondays and Thursdays from 09:00 Lagos, each active or pending Partner
 *   gets their progress email (runPartnerDigests). Hourly, not daily, so a
 *   send day whose 09:00 run hit a provider outage is made up at 10:00 — and
 *   every other tick of the week is one query that finds it is not a send day.
 *
 * Throws when a send day sent nothing and everything failed, so cron_run
 * records the failure and the health page and alerts say so. A day where some
 * failed is a success with the failures in its summary, retried next hour.
 * Auth via a Bearer header or ?key=CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });

  return withCronRun("partner-emails", async () => {
    const status = await retryStatusEmails();
    const digest = await runPartnerDigests();

    if (digest.slot && digest.sent === 0 && digest.failed > 0) {
      throw new Error(
        `Partner progress emails for ${digest.slot}: all ${digest.failed} failed — ${digest.errors[0] ?? "unknown error"}`,
      );
    }
    return Response.json({ ok: true, status, digest });
  });
}
