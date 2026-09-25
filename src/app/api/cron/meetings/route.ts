import {
  endAbandonedMeetings,
  expireMissedMeetings,
  pruneSignals,
} from "@/lib/meetings";
import { warmScriptureCache } from "@/lib/scripture";
import { QUICK_VERSES } from "@/lib/scripture-shared";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/meetings — housekeeping. Every 10 minutes.
 *
 * Three jobs, all of them about rooms nobody is looking after any more:
 *
 *  1. Close meetings whose last participant closed a laptop lid instead of
 *     pressing Leave. Without this they stay "live" for ever, show a green dot
 *     on the list, and count towards the church's live total.
 *  2. Cancel meetings that were scheduled and never opened, well after the
 *     fact, so the upcoming list is things that are actually coming up.
 *  3. Sweep consumed signalling rows. That table is a transport buffer — its
 *     rows are read within a second or two and are meaningless a minute later.
 *     The sweep is always age-scoped, and it is the ONLY table this touches:
 *     the record of what happened in a meeting lives in meeting_participant,
 *     meeting_message, meeting_recording and the audit log, and none of those
 *     is ever swept.
 *
 * Auth via ?key=CRON_SECRET or a Bearer header, as with every other cron here.
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

  return withCronRun("meetings", async () => {
    const ended = await endAbandonedMeetings();
    const expired = await expireMissedMeetings();
    const swept = await pruneSignals(10);

    // Once a day is plenty, and it is somebody else's free service — so this
    // only runs on the first tick of the hour before most Sunday services.
    let warmed = 0;
    if (new Date().getUTCHours() === 5 && new Date().getUTCMinutes() < 10) {
      warmed = await warmScriptureCache(QUICK_VERSES);
    }

    return new Response(
      JSON.stringify({ ok: true, ended, expired, swept, warmed }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
}
